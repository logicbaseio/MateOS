import { Router, type IRouter } from "express";
import { asc, inArray } from "drizzle-orm";
import { db, brainMessages } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  BRAIN_TOOLS,
  executeTool,
  loadSoul,
  buildSystemPrompt,
  runChannelBrainQuery,
} from "../brain/engine";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const router: IRouter = Router();

function toolSummary(name: string, result: string): string {
  const lines = result.split("\n").filter(Boolean);
  if (lines.length === 0) return "Done";
  if (name === "get_dashboard_stats") return lines.slice(0, 3).join(" · ");
  if (lines.length === 1) return lines[0].length > 80 ? lines[0].slice(0, 77) + "…" : lines[0];
  return `${lines.length} item${lines.length !== 1 ? "s" : ""} returned`;
}

router.get("/brain/messages", async (_req, res): Promise<void> => {
  const msgs = await db.select().from(brainMessages).orderBy(asc(brainMessages.createdAt));
  res.json(msgs);
});

router.delete("/brain/messages", async (_req, res): Promise<void> => {
  await db.delete(brainMessages);
  res.sendStatus(204);
});

router.post("/brain/chat", async (req, res): Promise<void> => {
  const { content } = req.body as { content?: unknown };
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  await db.insert(brainMessages).values({ role: "user", content: content.trim() });

  const soulContent = await loadSoul();
  const systemPrompt = await buildSystemPrompt(soulContent);

  const history = await db.select().from(brainMessages).orderBy(asc(brainMessages.createdAt));

  // Sanitize: find any assistant tool_call rows with no matching tool result (corrupted state).
  // Permanently delete them from the DB so they don't poison every future request.
  const toolResultIds = new Set(
    history.filter((m) => m.role === "tool" && m.toolCallId).map((m) => m.toolCallId!)
  );
  const orphanedIds = history
    .filter((m) => m.role === "assistant" && m.toolCallId && !toolResultIds.has(m.toolCallId))
    .map((m) => m.id);
  if (orphanedIds.length > 0) {
    console.warn(`[brain/chat] Removing ${orphanedIds.length} orphaned tool_call row(s) from DB:`, orphanedIds);
    await db.delete(brainMessages).where(inArray(brainMessages.id, orphanedIds));
  }
  const sanitizedHistory = history.filter((m) => !orphanedIds.includes(m.id));

  function buildOpenaiMessages(hist: typeof sanitizedHistory): ChatCompletionMessageParam[] {
    return [
      { role: "system", content: systemPrompt },
      ...hist.map((m): ChatCompletionMessageParam => {
        if (m.role === "tool") {
          return { role: "tool", tool_call_id: m.toolCallId ?? "unknown", content: m.toolResult ?? "" };
        }
        if (m.role === "assistant" && m.toolCallId) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: [{ id: m.toolCallId, type: "function", function: { name: m.toolName ?? "", arguments: m.toolInput ?? "{}" } }],
          };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      }),
    ];
  }

  const openaiMessages: ChatCompletionMessageParam[] = buildOpenaiMessages(sanitizedHistory);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let continueLoop = true;
    while (continueLoop) {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages: openaiMessages,
        tools: BRAIN_TOOLS,
        tool_choice: "auto",
        stream: true,
      });

      const currentToolCalls: Record<string, { id: string; name: string; args: string }> = {};
      let streamText = "";
      let hasToolCalls = false;

      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          streamText += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const key = String(tc.index ?? 0);
            if (!currentToolCalls[key]) currentToolCalls[key] = { id: tc.id ?? "", name: "", args: "" };
            if (tc.id) currentToolCalls[key].id = tc.id;
            if (tc.function?.name) currentToolCalls[key].name += tc.function.name;
            if (tc.function?.arguments) currentToolCalls[key].args += tc.function.arguments;
          }
        }
      }

      if (streamText && !hasToolCalls) {
        await db.insert(brainMessages).values({ role: "assistant", content: streamText });
        openaiMessages.push({ role: "assistant", content: streamText });
      }

      if (hasToolCalls) {
        const toolCallList = Object.values(currentToolCalls);

        const assistantToolMsg: ChatCompletionMessageParam = {
          role: "assistant",
          content: streamText || null,
          tool_calls: toolCallList.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        };
        openaiMessages.push(assistantToolMsg);

        for (const tc of toolCallList) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.args) as Record<string, unknown>; } catch { /* invalid JSON */ }

          res.write(`data: ${JSON.stringify({ tool: tc.name, status: "running" })}\n\n`);

          await db.insert(brainMessages).values({
            role: "assistant",
            content: streamText || "",
            toolName: tc.name,
            toolCallId: tc.id,
            toolInput: tc.args,
          });

          const result = await executeTool(tc.name, args);

          await db.insert(brainMessages).values({
            role: "tool",
            content: result,
            toolName: tc.name,
            toolCallId: tc.id,
            toolResult: result,
          });

          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          res.write(`data: ${JSON.stringify({ tool: tc.name, status: "done", summary: toolSummary(tc.name, result), result })}\n\n`);
        }
      } else {
        continueLoop = false;
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isCorruptHistory = errMsg.includes("tool_calls") && errMsg.includes("tool messages");

    if (isCorruptHistory) {
      // Corrupt conversation history — nuke it and retry with just the user's message
      console.warn("[brain/chat] Corrupt history detected — clearing all brain messages and retrying.");
      await db.delete(brainMessages);
      const freshMessages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: content.trim() },
      ];
      try {
        const retryResponse = await openai.chat.completions.create({
          model: "gpt-5.2",
          max_completion_tokens: 4096,
          messages: freshMessages,
          tools: BRAIN_TOOLS,
          tool_choice: "auto",
          stream: true,
        });
        let retryText = "";
        for await (const chunk of retryResponse) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            retryText += delta.content;
            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
          }
        }
        if (retryText) {
          await db.insert(brainMessages).values({ role: "user", content: content.trim() });
          await db.insert(brainMessages).values({ role: "assistant", content: retryText });
        }
      } catch (retryErr) {
        console.error("[brain/chat] Retry after history clear also failed:", retryErr);
        res.write(`data: ${JSON.stringify({ error: "Conversation history was corrupted and has been cleared. Please try again." })}\n\n`);
      }
    } else {
      console.error("Brain chat error:", err);
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

router.post("/brain/test-zara", async (req, res): Promise<void> => {
  const { message, history, channelType, mode } = req.body as {
    message?: string;
    history?: Array<{ role: string; content: string }>;
    channelType?: string;
    mode?: "boss" | "customer";
  };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  try {
    const { reply } = await runChannelBrainQuery(
      message.trim(),
      (history ?? []) as Array<{ role: "user" | "assistant"; content: string }>,
      channelType ?? "whatsapp",
      "test-user",
      0,
      null,
      mode ?? "customer",
    );
    res.json({ reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
