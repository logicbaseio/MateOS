import { Router } from "express";
import { eq, and, gt, asc } from "drizzle-orm";
import { readFile } from "fs/promises";
import { db, conversations, messages } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { SOUL_PATH } from "./soul";
import { applyNames, loadNames } from "../brain/engine";

const router = Router();

// Track the auto-brief message ID per customer conversation so we UPDATE it
// each time rather than stacking many brief messages in the boss panel.
const autoBriefMessageId = new Map<number, number>();

async function loadSoulContent(): Promise<string> {
  try {
    return await readFile(SOUL_PATH, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Build the system prompt that makes the assistant brief the boss about the live call.
 * STRICT: Only report what the caller explicitly said. No extrapolation.
 */
async function buildVoiceBriefPrompt(soulContent: string, transcript: Array<{ role: string; content: string }>) {
  const { bossName, botName } = await loadNames();
  const lines = transcript
    .map((m) => `${m.role === "user" ? "Caller" : botName}: ${m.content}`)
    .join("\n");

  const soulSection = soulContent ? `${soulContent}\n\n---\n\n` : "";

  const raw = `${soulSection}You are ${botName}. You're on a live voice call and need to send ${bossName} a private message asking them to confirm something you cannot handle on your own.

Call transcript:
${lines}

STRICT RULES — violating these is a critical failure:
- ONLY include facts the caller explicitly stated in the transcript above. Do NOT infer, assume, or extrapolate anything.
- Do NOT mention ${bossName}'s availability, preferences, or schedule unless the caller or ${botName} already stated it in the transcript.
- Do NOT say things like "they want X" if X was not said in the transcript.
- If the caller's name is unknown, say "name unknown".
- If no specific time was mentioned, say "no time given".

Write 1-3 sentences to ${bossName} in your normal casual owner-mode voice. Tell them:
1. Who called (name/company if stated) and what they want (only what was actually said)
2. The specific thing you need them to confirm or decide (e.g. "Can you do 4 PM tomorrow?")

Do NOT start with "Hey ${bossName}," — jump straight to the update.`;

  return applyNames(raw, bossName, botName);
}

/**
 * Builds the end-of-call summary prompt — more thorough than the mid-call brief.
 */
async function buildCallSummaryPrompt(soulContent: string, transcript: Array<{ role: string; content: string }>) {
  const { bossName, botName } = await loadNames();
  const lines = transcript
    .map((m) => `${m.role === "user" ? "Caller" : botName}: ${m.content}`)
    .join("\n");

  const soulSection = soulContent ? `${soulContent}\n\n---\n\n` : "";

  const raw = `${soulSection}You are ${botName}. A voice call just ended. Send ${bossName} a private wrap-up.

Full transcript:
${lines}

Give ${bossName} a complete but tight summary: who called, what they wanted, what was agreed (if anything), contact details, and what still needs action from them. Use your normal owner-mode voice — 2-4 sentences max.`;

  return applyNames(raw, bossName, botName);
}

async function triggerBossBriefing(customerConvoId: number): Promise<void> {
  // Only brief once per call — don't keep updating as the conversation grows.
  // The end-of-call summary handles the final state.
  if (autoBriefMessageId.has(customerConvoId)) return;

  try {
    const [customerConvo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, customerConvoId));

    if (!customerConvo?.linkedConvoId) return;

    const bossConvoId = customerConvo.linkedConvoId;

    const customerMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, customerConvoId))
      .orderBy(asc(messages.createdAt));

    const soulContent = await loadSoulContent();
    const systemPrompt = await buildVoiceBriefPrompt(
      soulContent,
      customerMessages.map((m) => ({ role: m.role, content: m.content }))
    );

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.5, // Lower temp = less creative extrapolation
    });

    const briefText = completion.choices[0]?.message?.content;
    if (!briefText) return;

    const [saved] = await db
      .insert(messages)
      .values({ conversationId: bossConvoId, role: "assistant", content: briefText })
      .returning();
    autoBriefMessageId.set(customerConvoId, saved.id);
  } catch (err) {
    console.error("[voice/brief] background briefing failed:", err);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.post("/voice/log/:convoId", async (req, res): Promise<void> => {
  const convoId = parseInt(req.params.convoId);
  if (isNaN(convoId)) {
    res.status(400).json({ error: "Invalid convoId" });
    return;
  }
  const { role, content } = req.body;
  if (!role || !content?.trim()) {
    res.status(400).json({ error: "Missing role or content" });
    return;
  }

  const [msg] = await db
    .insert(messages)
    .values({ conversationId: convoId, role, content })
    .returning();

  res.json(msg);

  // Brief the boss only once — after the 4th caller message, by which point
  // the assistant has collected enough info (name, purpose, timing) to make a real ask.
  // Firing on message #1 causes hallucination; the end-of-call summary covers the rest.
  if (role === "user") {
    const userMsgCount = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, convoId), eq(messages.role, "user")));
    if (userMsgCount.length === 4) {
      triggerBossBriefing(convoId);
    }
  }
});

router.post("/voice/brief-boss/:customerConvoId", async (req, res): Promise<void> => {
  const customerConvoId = parseInt(req.params.customerConvoId);
  if (isNaN(customerConvoId)) {
    res.status(400).json({ error: "Invalid customerConvoId" });
    return;
  }

  const [customerConvo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, customerConvoId));

  if (!customerConvo?.linkedConvoId) {
    res.status(404).json({ error: "No linked boss conversation found" });
    return;
  }

  const bossConvoId = customerConvo.linkedConvoId;

  const customerMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, customerConvoId))
    .orderBy(asc(messages.createdAt));

  if (customerMessages.length < 1) {
    res.status(400).json({ error: "No transcript to summarise" });
    return;
  }

  const soulContent = await loadSoulContent();
  const systemPrompt = await buildCallSummaryPrompt(
    soulContent,
    customerMessages.map((m) => ({ role: m.role, content: m.content }))
  );

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: systemPrompt }],
    temperature: 0.7,
  });

  const summaryText = completion.choices[0]?.message?.content;
  if (!summaryText) {
    res.status(500).json({ error: "Failed to generate summary" });
    return;
  }

  // End-of-call summary always appends as a fresh message so the boss can see
  // the final wrap-up separately from the mid-call updates.
  autoBriefMessageId.delete(customerConvoId); // Reset so next call starts fresh
  const [savedMsg] = await db
    .insert(messages)
    .values({ conversationId: bossConvoId, role: "assistant", content: summaryText })
    .returning();

  res.json(savedMsg);
});

router.get("/voice/boss-poll/:bossConvoId", async (req, res): Promise<void> => {
  const bossConvoId = parseInt(req.params.bossConvoId);
  if (isNaN(bossConvoId)) {
    res.status(400).json({ error: "Invalid bossConvoId" });
    return;
  }
  const sinceId = parseInt(req.query.sinceId as string) || 0;

  const newMsgs = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, bossConvoId),
        eq(messages.role, "user"),
        gt(messages.id, sinceId)
      )
    );

  res.json(newMsgs);
});

export default router;
