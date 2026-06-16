import { Router, type IRouter } from "express";
import { eq, asc, desc } from "drizzle-orm";
import { db, conversations, messages, preferencesTable, bossMemoryTable, sunnyNotifications } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { voiceChatStream, ensureCompatibleFormat, speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { getLLMClient } from "../../lib/llm";
import { executeTool, getToolsForMode, NOTIFY_BOSS_TOOL, loadNames, loadSoul } from "../../brain/engine";
import { getBossPersona } from "../../brain/persona";
import {
  ListOpenaiConversationsResponse,
  CreateOpenaiConversationBody,
  ListOpenaiConversationsResponseItem,
  GetOpenaiConversationParams,
  GetOpenaiConversationResponse,
  DeleteOpenaiConversationParams,
  SendOpenaiMessageParams,
  SendOpenaiMessageBody,
  SendOpenaiVoiceMessageParams,
  SendOpenaiVoiceMessageBody,
  CreateLinkedConversationsBody,
  GetLinkedConversationPairParams,
} from "@workspace/api-zod";
import type { ChatCompletionMessageToolCall, ChatCompletionTool } from "openai/resources/chat/completions";

const router: IRouter = Router();

type FunctionTool = Extract<ChatCompletionTool, { type: "function" }>;
type FunctionToolCall = Extract<ChatCompletionMessageToolCall, { type: "function" }>;
const BOSS_NOTIFICATION_TOOL_NAMES = new Set(["notify_boss", "notify_sunny"]);

function isFunctionTool(tool: ChatCompletionTool): tool is FunctionTool {
  return tool.type === "function";
}

function isFunctionToolCall(toolCall: ChatCompletionMessageToolCall): toolCall is FunctionToolCall {
  return toolCall.type === "function";
}


async function loadBossMemoryBlock(): Promise<string> {
  const memories = await db.select().from(bossMemoryTable).orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key));
  if (memories.length === 0) return "";
  const grouped: Record<string, typeof memories> = {};
  for (const m of memories) {
    if (!grouped[m.section]) grouped[m.section] = [];
    grouped[m.section].push(m);
  }
  const lines = Object.entries(grouped).map(([section, items]) => {
    const entries = items.map(m => {
      const tagStr = m.tags && (m.tags as string[]).length > 0 ? ` [tags: ${(m.tags as string[]).join(", ")}]` : "";
      const imp = m.importance === 3 ? " ⚠️ CRITICAL" : m.importance === 2 ? " ★" : "";
      return `  • ${m.key}: ${m.value}${tagStr}${imp}`;
    });
    return `### ${section.charAt(0).toUpperCase() + section.slice(1)}\n${entries.join("\n")}`;
  });
  return `\n\n## What I Know About the Boss\n\n${lines.join("\n\n")}`;
}

async function buildBossPrompt(soulContent: string, customerMessages: Array<{ role: string; content: string }>) {
  const { bossName, botName } = await loadNames();
  const customerContext =
    customerMessages.length > 0
      ? `\n\n---\nHere's the current customer conversation (so you know exactly what's going on):\n${customerMessages
          .map((m) => `${m.role === "user" ? "Customer" : botName}: ${m.content}`)
          .join("\n")}\n---`
      : "";

  const substitutedSoul = soulContent
    .replace(/\bZara\b/g, botName)
    .replace(/\bSunny\b/g, bossName);
  const soulSection = substitutedSoul ? `${substitutedSoul}\n\n---\n\n` : "";
  const memoryBlock = await loadBossMemoryBlock();

  return `${soulSection}You're talking privately with ${bossName} right now (boss mode).${memoryBlock}

You have LIVE tool access to ${bossName}'s Microsoft 365 data — calendar, emails, Teams chats — and to MateOS tools (meeting requests, preferences, etc.). When ${bossName} asks about any of these, call the relevant tool immediately rather than saying you don't have access.

You also have access to recall_boss_memory — use it any time you need to look up a specific fact about ${bossName} mid-conversation. The memory block above is a snapshot from session start; recall_boss_memory gives you live lookup with section/tag filtering.

## AI Scheduler Preferences (IMPORTANT)

You can read and update the AI Scheduler rules through natural language. When ${bossName} mentions anything about their location, timezone, available times, appointment windows, meeting limits, or mood — update the preferences immediately using update_preferences. Always call get_preferences first so you know the current values.

Key fields you can set:
- **currentCity** + **timezone**: Derive the IANA timezone from the city (e.g. "New York" → "America/New_York", "London" → "Europe/London", "Dubai" → "Asia/Dubai")
- **workdayStart** / **workdayEnd**: The appointment availability window in HH:MM 24h format (e.g. "2AM" → "02:00", "6PM" → "18:00"). These are in the boss's local timezone.
- **maxMeetingsPerDay**: How many appointments per day
- **meetingDurationMinutes**: Default meeting length
- **breakBetweenMeetings**: Minimum gap between meetings in minutes
- **mood**: available / busy / do_not_disturb / flexible
- **notes**: Any other scheduling rules or instructions in free text

If ${bossName} says something ambiguous (e.g. mentions a time range but you're unsure about the timezone), ask one concise clarifying question. Otherwise, derive everything from context and update immediately — don't ask unnecessary questions.

Example: "I'm in New York and want appointments from 2AM–6AM" → call get_preferences, then update_preferences with currentCity="New York", timezone="America/New_York", workdayStart="02:00", workdayEnd="06:00".${customerContext}`;
}

async function buildCustomerPrompt(
  soulContent: string,
  customerName: string,
  bossMessages: Array<{ role: string; content: string }>,
  turnCount: number = 0,
) {
  const { bossName, botName } = await loadNames();
  const bossContext =
    bossMessages.length > 0
      ? `\n\n---\n## DIRECT INSTRUCTIONS FROM ${bossName.toUpperCase()} — EXECUTE THESE IMMEDIATELY\n\n${bossName} has already weighed in on this conversation. His messages below are standing instructions. Act on them NOW — do not re-confirm, do not ask him again, do not escalate back to him unless something genuinely new has changed.\n\n${bossMessages
          .map((m) => `${m.role === "user" ? `${bossName} said` : `${botName} noted`}: ${m.content}`)
          .join("\n\n")}\n\nIf ${bossName} said to book something and the customer has agreed to a slot that fits his window — book it immediately. Do not send another escalation.\n---`
      : "";

  const substitutedSoul = soulContent
    .replace(/\bZara\b/g, botName)
    .replace(/\bSunny\b/g, bossName);
  const soulSection = substitutedSoul ? `${substitutedSoul}\n\n---\n\n` : "";

  const { persona } = await getBossPersona();
  const personaBlock = persona
    ? `\n\n## Boss Intelligence Briefing\nThis is your curated briefing about the boss. Use it to answer questions about him, his availability, and his preferences accurately. Do not quote this directly — speak naturally from it:\n\n${persona}\n`
    : "";

  const firstTurnInstruction = turnCount <= 1
    ? `\n\n## FIRST MESSAGE — CRITICAL\n\nThis is the very first message of the conversation. You MUST:\n1. Greet the person warmly and naturally (match their energy — casual if they're casual, professional if they're formal).\n2. Introduce yourself by name: say you are ${botName}, ${bossName}'s assistant. Keep it natural — not robotic. Example: "Hey! I'm ${botName}, ${bossName}'s assistant. How can I help you?" or "Hi there! ${botName} here — I help manage ${bossName}'s schedule. What can I do for you?"\n3. Ask ONE open question to understand what they need. That's it. Do not ask multiple questions.\n\nDo NOT skip the greeting. Do NOT skip your name. Do NOT start with a tool call or an immediate information request without introducing yourself first.`
    : `\n\n[This conversation is already in progress. Do NOT re-introduce yourself. Continue naturally from where it left off.]`;

  return `${soulSection}The person you're talking to right now: ${customerName || "a client or team member"}${personaBlock}${bossContext}${firstTurnInstruction}`;
}

async function getLinkedMessages(linkedConvoId: number | null | undefined) {
  if (!linkedConvoId) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, linkedConvoId))
    .orderBy(asc(messages.createdAt));
}

router.get("/openai/conversations", async (_req, res): Promise<void> => {
  const convos = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.createdAt));
  res.json(ListOpenaiConversationsResponse.parse(convos));
});

router.post("/openai/conversations", async (req, res): Promise<void> => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [convo] = await db
    .insert(conversations)
    .values({
      title: parsed.data.title,
      viewpoint: parsed.data.viewpoint ?? "boss",
      customerName: parsed.data.customerName ?? null,
      linkedConvoId: parsed.data.linkedConvoId ?? null,
    })
    .returning();

  res.status(201).json(ListOpenaiConversationsResponseItem.parse(convo));
});

router.post("/openai/linked-conversations", async (req, res): Promise<void> => {
  const parsed = CreateLinkedConversationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const customerName = parsed.data.customerName || "Guest";

  const [customerConvo] = await db
    .insert(conversations)
    .values({
      title: `${customerName}'s Appointment`,
      viewpoint: "customer",
      customerName,
      linkedConvoId: null,
    })
    .returning();

  const [bossConvo] = await db
    .insert(conversations)
    .values({
      title: `Re: ${customerName}`,
      viewpoint: "boss",
      customerName,
      linkedConvoId: customerConvo.id,
    })
    .returning();

  await db
    .update(conversations)
    .set({ linkedConvoId: bossConvo.id })
    .where(eq(conversations.id, customerConvo.id));

  const updatedCustomer = { ...customerConvo, linkedConvoId: bossConvo.id };

  res.status(201).json({
    customerConvo: updatedCustomer,
    bossConvo,
  });
});

router.get("/openai/linked-conversations/:id", async (req, res): Promise<void> => {
  const params = GetLinkedConversationPairParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!convo) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const linkedId = convo.linkedConvoId;
  if (!linkedId) {
    res.status(404).json({ error: "No linked conversation" });
    return;
  }

  const [linked] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, linkedId));

  if (!linked) {
    res.status(404).json({ error: "Linked conversation not found" });
    return;
  }

  const customerConvo = convo.viewpoint === "customer" ? convo : linked;
  const bossConvo = convo.viewpoint === "boss" ? convo : linked;

  const [customerMsgs, bossMsgs] = await Promise.all([
    db.select().from(messages).where(eq(messages.conversationId, customerConvo.id)).orderBy(asc(messages.createdAt)),
    db.select().from(messages).where(eq(messages.conversationId, bossConvo.id)).orderBy(asc(messages.createdAt)),
  ]);

  res.json({
    customerConvo: { ...customerConvo, messages: customerMsgs },
    bossConvo: { ...bossConvo, messages: bossMsgs },
  });
});

router.get("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = GetOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!convo) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));

  res.json(GetOpenaiConversationResponse.parse({ ...convo, messages: msgs }));
});

router.delete("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = SendOpenaiMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SendOpenaiMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!convo) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messages).values({
    conversationId: params.data.id,
    role: "user",
    content: parsed.data.content,
  });

  const [history, linkedMessages, soulContent] = await Promise.all([
    db.select().from(messages).where(eq(messages.conversationId, params.data.id)).orderBy(asc(messages.createdAt)),
    getLinkedMessages(convo.linkedConvoId),
    loadSoul(),
  ]);

  const viewpoint = convo.viewpoint ?? parsed.data.viewpoint ?? "boss";
  const customerName = convo.customerName ?? parsed.data.customerName ?? "";

  const systemPrompt =
    viewpoint === "customer"
      ? await buildCustomerPrompt(soulContent, customerName, linkedMessages, history.length)
      : await buildBossPrompt(soulContent, linkedMessages);

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  // Load tool permissions from Bot Permissions page
  const [relayPrefs] = await db.select().from(preferencesTable).limit(1);
  const relayToolConfig = relayPrefs?.toolConfig;

  const { client: llmClient, model: llmModel } = await getLLMClient();

  try {
    if (viewpoint === "boss") {
      // Boss mode: non-streaming tool loop using tools enabled in Bot Permissions
      const bossTools = getToolsForMode(relayToolConfig, "boss");
      type OAIMsg = Parameters<typeof openai.chat.completions.create>[0]["messages"][0];
      const loopMessages: OAIMsg[] = chatMessages as OAIMsg[];
      let continueLoop = true;

      while (continueLoop) {
        const resp = await llmClient.chat.completions.create({
          model: llmModel,
          max_completion_tokens: 8192,
          messages: loopMessages,
          tools: bossTools,
          tool_choice: "auto",
          stream: false,
        });

        const choice = resp.choices[0];
        const msg = choice?.message;
        if (!msg) break;

        const toolCalls = (msg.tool_calls ?? []).filter(isFunctionToolCall);

        if (msg.content && toolCalls.length === 0) {
          fullResponse = msg.content;
          continueLoop = false;
        } else if (toolCalls.length > 0) {
          loopMessages.push(msg as OAIMsg);
          const toolResultMessages: OAIMsg[] = [];
          for (const tc of toolCalls) {
            let result = "";
            try {
              const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
              result = await executeTool(tc.function.name, args);
            } catch (e) {
              result = `Tool error: ${String(e)}`;
            }
            toolResultMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result,
            } as OAIMsg);
          }
          loopMessages.push(...toolResultMessages);
        } else {
          continueLoop = false;
        }
      }

      if (fullResponse) {
        res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
      }
    } else {
      // Customer mode: tool loop using tools enabled in Bot Permissions.
      // Always include notify_boss so the assistant can escalate when needed.
      const permissionedCustomerTools = getToolsForMode(relayToolConfig, "customer").filter(isFunctionTool);
      const customerTools = permissionedCustomerTools.find(t => t.function.name === "notify_boss")
        ? permissionedCustomerTools
        : [...permissionedCustomerTools, NOTIFY_BOSS_TOOL];

      type OAIMsg = Parameters<typeof openai.chat.completions.create>[0]["messages"][0];
      const custLoopMessages: OAIMsg[] = chatMessages as OAIMsg[];
      let custContinue = true;

      while (custContinue) {
        const resp = await llmClient.chat.completions.create({
          model: llmModel,
          max_completion_tokens: 8192,
          messages: custLoopMessages,
          tools: customerTools,
          tool_choice: "auto",
          stream: false,
        });

        const choice = resp.choices[0];
        const msg = choice?.message;
        if (!msg) break;

        const toolCalls = (msg.tool_calls ?? []).filter(isFunctionToolCall);

        if (msg.content && toolCalls.length === 0) {
          fullResponse = msg.content;
          custContinue = false;
        } else if (toolCalls.length > 0) {
          custLoopMessages.push(msg as OAIMsg);
          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>; } catch { /* ignore */ }

            let result = "";

            if (BOSS_NOTIFICATION_TOOL_NAMES.has(tc.function.name)) {
              // Handle boss notifications for web chat: record the notification AND inject it into the
              // linked boss conversation so it appears in the boss panel in real time.
              try {
                const notifMsg = typeof args.message === "string" ? args.message : "";
                const notifCtx = typeof args.context === "string" ? args.context : "";

                const [inserted] = await db.insert(sunnyNotifications).values({
                  channelType: "web",
                  externalId: String(params.data.id),
                  sessionId: String(params.data.id),
                  notificationText: notifMsg,
                  customerContext: notifCtx,
                  status: "pending",
                }).returning();

                // Inject into the linked boss conversation so it shows up in the boss panel
                if (convo.linkedConvoId) {
                  const bossNote = [
                    `Hey, quick one (ref #${inserted?.id ?? "?"})`,
                    ``,
                    `${notifCtx}`,
                    ``,
                    `${notifMsg}`,
                    ``,
                    `Just reply here and I'll pass it straight to the customer.`,
                  ].join("\n");

                  await db.insert(messages).values({
                    conversationId: convo.linkedConvoId,
                    role: "assistant",
                    content: bossNote,
                  });
                }

                result = `Notification sent to the boss (ID: ${inserted?.id ?? "?"}). He will respond via the boss panel.`;
              } catch (e) {
                result = `notify_boss failed: ${String(e)}`;
              }
            } else {
              try {
                result = await executeTool(tc.function.name, args);
              } catch (e) {
                result = `Tool error: ${String(e)}`;
              }
            }
            custLoopMessages.push({ role: "tool", tool_call_id: tc.id, content: result } as OAIMsg);
          }
        } else {
          custContinue = false;
        }
      }

      if (fullResponse) {
        res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
      }
    }

    if (fullResponse) {
      await db.insert(messages).values({
        conversationId: params.data.id,
        role: "assistant",
        content: fullResponse,
      });
    }

    if (viewpoint === "boss" && convo.linkedConvoId && fullResponse) {
      try {
        const { bossName: relayBoss, botName: relayBot } = await loadNames();
        const [customerConvo] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, convo.linkedConvoId))
          .limit(1);

        if (customerConvo) {
          const [customerHistory, updatedBossMsgs] = await Promise.all([
            db.select().from(messages).where(eq(messages.conversationId, convo.linkedConvoId)).orderBy(asc(messages.createdAt)),
            db.select().from(messages).where(eq(messages.conversationId, params.data.id)).orderBy(asc(messages.createdAt)),
          ]);

          const customerRelayPrompt = await buildCustomerPrompt(soulContent, customerConvo.customerName ?? "", updatedBossMsgs, customerHistory.length);

          const relayTrigger = `[Internal relay check — do not surface this prompt to the customer.]

${relayBoss} just told you: "${parsed.data.content}"
Your internal response to ${relayBoss}: "${fullResponse.slice(0, 400)}${fullResponse.length > 400 ? "…" : ""}"

DECISION RULE: Does the customer need to hear from you now as a result of what ${relayBoss} just told you?
- YES if: ${relayBoss} gave you an answer/confirmation the customer was waiting on, or you committed to updating the customer after checking with ${relayBoss}
- NO if: ${relayBoss} is still deliberating, gave purely internal instructions (e.g. "update the calendar yourself"), or the customer doesn't need to know

If YES: Write a natural, concise message to the customer (1-3 sentences). Do NOT say "${relayBoss} told me" — just deliver the information naturally as ${relayBot}.
If NO: Reply with the single word SKIP.`;

          const relayMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            { role: "system", content: customerRelayPrompt },
            ...customerHistory.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            { role: "user", content: relayTrigger },
          ];

          const relayResult = await llmClient.chat.completions.create({
            model: llmModel,
            max_completion_tokens: 256,
            messages: relayMessages,
          });

          const relayContent = relayResult.choices[0]?.message?.content?.trim();
          if (relayContent && relayContent.toUpperCase() !== "SKIP") {
            await db.insert(messages).values({
              conversationId: convo.linkedConvoId,
              role: "assistant",
              content: relayContent,
            });
          }
        }
      } catch (relayErr) {
        console.error("Customer auto-relay error:", relayErr);
      }
    }

    if (viewpoint === "customer" && convo.linkedConvoId && fullResponse) {
      try {
        const { bossName: briefBoss } = await loadNames();
        const [bossHistory, updatedCustomerMsgs] = await Promise.all([
          db.select().from(messages).where(eq(messages.conversationId, convo.linkedConvoId!)).orderBy(asc(messages.createdAt)),
          db.select().from(messages).where(eq(messages.conversationId, params.data.id)).orderBy(asc(messages.createdAt)),
        ]);

        const bossBriefPrompt = await buildBossPrompt(soulContent, updatedCustomerMsgs);

        const briefingTrigger = `[Internal decision only — do not surface this to the customer.]

Customer's last message: "${parsed.data.content}"
Your response to them: "${fullResponse.slice(0, 400)}${fullResponse.length > 400 ? "…" : ""}"

DECISION RULE: Only write to ${briefBoss} if you genuinely cannot proceed without his input — e.g. you committed to confirming something with him, you need his approval, or you lack information only he can provide.

Do NOT write to ${briefBoss} for:
- Routine info-gathering (name, topic, duration, preferences)
- Greetings, small talk, or acknowledgements
- Clarifying questions you handled yourself
- Anything you fully resolved without needing ${briefBoss}

If ${briefBoss} IS needed: reply with 1-2 sentences telling him exactly what you need.
If ${briefBoss} is NOT needed: reply with the single word SKIP.`;


        const bossBriefMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: bossBriefPrompt },
          ...bossHistory.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user", content: briefingTrigger },
        ];

        const briefingResult = await llmClient.chat.completions.create({
          model: llmModel,
          max_completion_tokens: 128,
          messages: bossBriefMessages,
        });

        const briefContent = briefingResult.choices[0]?.message?.content?.trim();
        if (briefContent && briefContent.toUpperCase() !== "SKIP") {
          await db.insert(messages).values({
            conversationId: convo.linkedConvoId!,
            role: "assistant",
            content: briefContent,
          });
        }
      } catch (briefErr) {
        console.error("Boss auto-brief error:", briefErr);
      }
    }
  } catch (err: unknown) {
    console.error("Text chat stream error:", err);
    const msg = err instanceof Error ? err.message : "Stream failed";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

router.post("/openai/conversations/:id/voice-messages", async (req, res): Promise<void> => {
  const params = SendOpenaiVoiceMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SendOpenaiVoiceMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!convo) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const audioBuffer = Buffer.from(parsed.data.audio, "base64");
  const { buffer, format } = await ensureCompatibleFormat(audioBuffer);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const userText = await speechToText(buffer, format);
    if (userText) {
      await db.insert(messages).values({
        conversationId: params.data.id,
        role: "user",
        content: userText,
      });
      res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userText })}\n\n`);
    }

    const stream = await voiceChatStream(buffer, "alloy", format);
    let assistantTranscript = "";

    for await (const event of stream) {
      if (event.type === "transcript") {
        assistantTranscript += event.data;
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (assistantTranscript) {
      await db.insert(messages).values({
        conversationId: params.data.id,
        role: "assistant",
        content: assistantTranscript,
      });
    }
  } catch (err: unknown) {
    console.error("Voice chat stream error:", err);
    const msg = err instanceof Error ? err.message : "Voice stream failed";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
