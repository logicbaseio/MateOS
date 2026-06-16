import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { db, channelConfigs, channelSessions, sunnyNotifications, preferencesTable } from "@workspace/db";
import { runChannelBrainQuery, runBrainQuery } from "../brain/engine";
import {
  getSunnyContact,
  deliverToChannel,
  deliverMessageToSunny,
  sendTelegram,
  sendSlack,
  sendWhatsApp,
  sendToTeams,
  sendDiscordFollowup,
} from "../lib/messenger";
import {
  downloadWhatsAppMedia,
  transcribeWithElevenLabs,
  handleWhatsAppVoiceNote,
  getVoiceNoteInstructions,
  detectScript,
} from "../lib/voiceNote";

const router: IRouter = Router();

type SessionMessage = { role: string; content: string };

/** Download and transcribe a WhatsApp audio message. Returns empty string on failure. */
async function transcribeWhatsAppAudio(
  mediaId: string,
  mimeType: string,
  accessToken: string,
): Promise<string> {
  try {
    const { buffer, mimeType: detectedMime } = await downloadWhatsAppMedia(mediaId, accessToken);
    return await transcribeWithElevenLabs(buffer, mimeType || detectedMime);
  } catch (err) {
    console.error("[webhook/whatsapp] transcribeWhatsAppAudio error:", err);
    return "";
  }
}

async function getChannelConfig(type: string): Promise<{ config: Record<string, string>; secret: string | null } | null> {
  const [row] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, type))
    .limit(1);
  if (!row || row.status !== "connected") return null;
  try {
    const config = JSON.parse(row.config) as Record<string, string>;
    return { config, secret: row.webhookSecret };
  } catch {
    return null;
  }
}

async function getOrCreateSession(channelType: string, externalId: string) {
  const [existing] = await db.select().from(channelSessions)
    .where(and(
      eq(channelSessions.channelType, channelType),
      eq(channelSessions.externalId, externalId),
    ))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(channelSessions).values({
    channelType,
    externalId,
    messages: "[]",
    status: "active",
  }).returning();

  return created;
}

async function appendSessionMessages(sessionId: number, newMessages: SessionMessage[]) {
  const [session] = await db.select().from(channelSessions).where(eq(channelSessions.id, sessionId)).limit(1);
  if (!session) return;

  let history: SessionMessage[] = [];
  try { history = JSON.parse(session.messages) as SessionMessage[]; } catch { /* ignore */ }

  history.push(...newMessages);
  const trimmed = history.slice(-40);

  await db.update(channelSessions)
    .set({ messages: JSON.stringify(trimmed), updatedAt: new Date() })
    .where(eq(channelSessions.id, sessionId));
}

async function processChannelMessage(
  channelType: string,
  externalId: string,
  userText: string,
  mode: "boss" | "customer" = "customer",
): Promise<{ reply: string; notificationId: number | null }> {
  const session = await getOrCreateSession(channelType, externalId);

  let history: SessionMessage[] = [];
  try { history = JSON.parse(session.messages) as SessionMessage[]; } catch { /* ignore */ }

  const [prefs] = await db.select().from(preferencesTable).limit(1);

  const { reply, notificationId } = await runChannelBrainQuery(
    userText,
    history,
    channelType,
    externalId,
    session.id,
    prefs?.toolConfig,
    mode,
  );

  await appendSessionMessages(session.id, [
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ]);

  if (!notificationId) {
    await db.update(channelSessions)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(channelSessions.id, session.id));
  }

  return { reply, notificationId };
}

async function isSunnyMessage(channelType: string, externalId: string): Promise<boolean> {
  const incomingNorm = externalId.replace(/\D/g, "");

  // Check 1: sunny_contact record — normalize both sides for WhatsApp (handles +, spaces, dashes)
  const contact = await getSunnyContact();
  if (contact && contact.channelType === channelType) {
    const storedNorm = channelType === "whatsapp"
      ? contact.externalId.replace(/\D/g, "")
      : contact.externalId;
    const compareIncoming = channelType === "whatsapp" ? incomingNorm : externalId;
    if (storedNorm && storedNorm === compareIncoming) {
      return true;
    }
  }

  // Check 2: bossPhone in preferences (digits-only, handles +1… vs 1…)
  if (channelType === "whatsapp") {
    const [prefs] = await db.select({ bossPhone: preferencesTable.bossPhone }).from(preferencesTable).limit(1);
    const stored = (prefs?.bossPhone ?? "").replace(/\D/g, "");
    if (stored && stored === incomingNorm) {
      console.log(`[boss-detect] Matched via bossPhone preference: ${incomingNorm}`);
      return true;
    }
  }

  // Log mismatch for debugging
  const storedDesc = contact
    ? `sunny_contact: ${contact.channelType}/${contact.externalId}`
    : "sunny_contact: (none)";
  console.log(`[boss-detect] NOT boss — incoming: ${channelType}/${externalId} | ${storedDesc}`);
  return false;
}

/**
 * Register or refresh the boss's delivery contact so that notifications
 * always go back via a channel where there IS an active session.
 * Called every time the boss sends a message so the 24-hour window stays open.
 */
async function refreshSunnyContact(channelType: string, externalId: string): Promise<void> {
  try {
    const configJson = JSON.stringify({ channelType, externalId });
    const existing = await db.select().from(channelConfigs)
      .where(eq(channelConfigs.channelType, "sunny_contact")).limit(1);
    if (existing.length > 0) {
      await db.update(channelConfigs)
        .set({ config: configJson, status: "connected", updatedAt: new Date() })
        .where(eq(channelConfigs.channelType, "sunny_contact"));
    } else {
      await db.insert(channelConfigs).values({
        channelType: "sunny_contact",
        config: configJson,
        status: "connected",
        webhookSecret: null,
        lastError: null,
      });
    }
  } catch (err) {
    console.warn("[refreshSunnyContact] failed:", err);
  }
}

async function relayThroughZara(
  notification: { id: number; channelType: string; externalId: string; sessionId: string; notificationText: string },
  sunnyInstruction: string,
): Promise<void> {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  const bossLabel = prefs?.bossName?.trim() || "Boss";
  const session = await getOrCreateSession(notification.channelType, notification.externalId);

  let history: SessionMessage[] = [];
  try { history = JSON.parse(session.messages) as SessionMessage[]; } catch { /* ignore */ }

  const triggerMessage = [
    `DIRECT INSTRUCTIONS FROM ${bossLabel.toUpperCase()} — EXECUTE IMMEDIATELY: ${sunnyInstruction}`,
    `[This is ${bossLabel}'s response to: "${notification.notificationText}". Take this as a final decision — do NOT ask for clarification, do NOT re-confirm, just act on it now.]`,
  ].join("\n");

  const { reply } = await runChannelBrainQuery(
    triggerMessage,
    history,
    notification.channelType,
    notification.externalId,
    session.id,
    prefs?.toolConfig,
  );

  await appendSessionMessages(session.id, [
    { role: "user", content: triggerMessage },
    { role: "assistant", content: reply },
  ]);

  await deliverToChannel(notification.channelType, notification.externalId, reply, true);

  void deliverMessageToSunny("Got it, passed it on.");

  // After handling this one, surface the next unanswered request naturally — one at a time
  const remaining = await db
    .select()
    .from(sunnyNotifications)
    .where(and(
      eq(sunnyNotifications.status, "pending"),
      // Exclude the one we just handled (already marked replied before calling this)
    ))
    .orderBy(desc(sunnyNotifications.createdAt))
    .limit(1);

  if (remaining.length > 0) {
    const next = remaining[0];
    const followUp = `One more thing — ${next.notificationText}\n\n↩ Reply *#${next.id}: your decision* and I'll handle it.`;
    setTimeout(() => {
      void deliverMessageToSunny(followUp);
    }, 2500);
  }
}

async function handleSunnyReply(channelType: string, text: string): Promise<void> {
  const trimmed = text.trim();
  const refMatch = trimmed.match(/^#(\d+)[:\s]+(.+)$/s);

  if (refMatch) {
    // Explicit #ID: target a specific notification
    const notificationId = Number(refMatch[1]);
    const replyText = refMatch[2].trim();

    const [notification] = await db
      .select()
      .from(sunnyNotifications)
      .where(and(eq(sunnyNotifications.id, notificationId), eq(sunnyNotifications.status, "pending")))
      .limit(1);

    if (!notification) {
      void deliverMessageToSunny(`⚠️ No pending request found with ID #${notificationId}. It may have already been handled.`);
      return;
    }

    await db.update(sunnyNotifications)
      .set({ status: "replied", sunnyReply: replyText, updatedAt: new Date() })
      .where(eq(sunnyNotifications.id, notification.id));
    await db.update(channelSessions)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(channelSessions.id, Number(notification.sessionId)));

    try {
      await relayThroughZara(notification, replyText);
    } catch (err) {
      console.error("[handleSunnyReply] relay error:", err);
      void deliverMessageToSunny("⚠️ Something went wrong relaying your reply. Please check the dashboard.");
    }
    return;
  }

  // No #ID prefix — nothing to handle. Callers are responsible for routing non-reply boss messages through Zara.
}

export async function deliverReplyToChannel(
  channelType: string,
  externalId: string,
  replyText: string,
): Promise<void> {
  return deliverToChannel(channelType, externalId, replyText);
}

router.post("/webhooks/telegram", async (req, res): Promise<void> => {
  const ch = await getChannelConfig("telegram");
  if (!ch) { res.sendStatus(200); return; }

  const incomingSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
  if (ch.secret && incomingSecret !== ch.secret) { res.sendStatus(403); return; }

  interface TelegramUpdate {
    message?: { chat?: { id?: number }; text?: string };
  }
  const update = req.body as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim();
  if (!chatId || !text) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    const isBoss = await isSunnyMessage("telegram", String(chatId));
    if (isBoss) {
      const refMatch = text.match(/^#(\d+)[:\s]+(.+)$/s);
      if (refMatch) { await handleSunnyReply("telegram", text); return; }
    }
    const { reply } = await processChannelMessage("telegram", String(chatId), text, isBoss ? "boss" : "customer");
    await sendTelegram(ch.config.botToken, chatId, reply);
  } catch (err) {
    console.error("[webhook/telegram] error:", err);
  }
});

router.post("/webhooks/slack", async (req, res): Promise<void> => {
  const ch = await getChannelConfig("slack");
  if (!ch) { res.sendStatus(200); return; }

  interface SlackBody {
    type?: string;
    challenge?: string;
    event?: { type?: string; text?: string; channel?: string; bot_id?: string; user?: string };
  }
  const body = req.body as SlackBody;

  if (body.type === "url_verification") { res.json({ challenge: body.challenge }); return; }

  if (ch.config.signingSecret) {
    const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;
    const slackSig = req.headers["x-slack-signature"] as string | undefined;
    if (timestamp && slackSig) {
      const rawBody = JSON.stringify(req.body);
      const sigBase = `v0:${timestamp}:${rawBody}`;
      const hmac = createHmac("sha256", ch.config.signingSecret).update(sigBase).digest("hex");
      try {
        if (!timingSafeEqual(Buffer.from(slackSig), Buffer.from(`v0=${hmac}`))) {
          res.sendStatus(403); return;
        }
      } catch { res.sendStatus(403); return; }
    }
  }

  const event = body.event;
  if (!event || event.type !== "message" || event.bot_id) { res.sendStatus(200); return; }

  const text = event.text?.trim();
  const channelId = event.channel ?? ch.config.channelId;
  const userId = event.user ?? channelId;
  if (!text || !channelId) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    const isBoss = await isSunnyMessage("slack", userId);
    if (isBoss) {
      const refMatch = text.match(/^#(\d+)[:\s]+(.+)$/s);
      if (refMatch) { await handleSunnyReply("slack", text); return; }
    }
    const { reply } = await processChannelMessage("slack", userId, text, isBoss ? "boss" : "customer");
    await sendSlack(ch.config.botToken, channelId, reply);
  } catch (err) {
    console.error("[webhook/slack] error:", err);
  }
});

router.post("/webhooks/discord", async (req, res): Promise<void> => {
  const ch = await getChannelConfig("discord");
  if (!ch) { res.sendStatus(200); return; }

  interface DiscordBody {
    type?: number;
    data?: { options?: Array<{ value?: string }>; content?: string };
    channel_id?: string;
    token?: string;
    member?: { user?: { id?: string } };
  }
  const body = req.body as DiscordBody;

  if (body.type === 1) { res.json({ type: 1 }); return; }

  if (body.type === 2) {
    const text = body.data?.options?.[0]?.value?.trim() ?? body.data?.content?.trim();
    const userId = body.member?.user?.id ?? body.channel_id ?? "unknown";
    if (!text) { res.sendStatus(200); return; }

    res.json({ type: 5 });

    try {
      const isBoss = await isSunnyMessage("discord", userId);
      if (isBoss) {
        const refMatch = text.match(/^#(\d+)[:\s]+(.+)$/s);
        if (refMatch) { await handleSunnyReply("discord", text); return; }
      }
      const { reply } = await processChannelMessage("discord", userId, text, isBoss ? "boss" : "customer");
      await sendDiscordFollowup(ch.config.applicationId, body.token ?? "", reply);
    } catch (err) {
      console.error("[webhook/discord] error:", err);
    }
    return;
  }

  res.sendStatus(200);
});

router.get("/webhooks/whatsapp", async (req, res): Promise<void> => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode !== "subscribe") { res.sendStatus(403); return; }

  const [ch, bb] = await Promise.all([
    getChannelConfig("whatsapp"),
    getBossBrainConfig(),
  ]);

  const customerToken = ch?.config.verifyToken;
  const bossToken = bb?.platform === "whatsapp" ? bb.config.verifyToken : undefined;

  if (token === customerToken || token === bossToken) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post("/webhooks/whatsapp", async (req, res): Promise<void> => {
  interface WABody {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: Array<{
            from?: string;
            type?: string;
            text?: { body?: string };
            audio?: { id?: string; mime_type?: string };
          }>;
        };
      }>;
    }>;
  }
  const body = req.body as WABody;
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const msgType = message?.type;
  if (!message || !msgType || !["text", "audio"].includes(msgType)) { res.sendStatus(200); return; }

  const from = message.from;
  const receivingPhoneId = value?.metadata?.phone_number_id;
  if (!from) { res.sendStatus(200); return; }

  const text = msgType === "text" ? (message.text?.body?.trim() ?? "") : "";
  const audioMediaId = msgType === "audio" ? (message.audio?.id ?? "") : "";
  const audioMimeType = msgType === "audio" ? (message.audio?.mime_type ?? "audio/ogg") : "";

  if (msgType === "text" && !text) { res.sendStatus(200); return; }
  if (msgType === "audio" && !audioMediaId) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    const bb = await getBossBrainConfig();
    const isBossBrainNumber = bb?.platform === "whatsapp" && receivingPhoneId && receivingPhoneId === bb.config.phoneNumberId;

    if (isBossBrainNumber) {
      const isBoss = await isSunnyMessage("whatsapp", from);
      if (isBoss) {
        let effectiveText = text;
        if (msgType === "audio" && audioMediaId) {
          console.log("[webhook/whatsapp] Boss sent voice note on brain channel — transcribing");
          effectiveText = await transcribeWhatsAppAudio(audioMediaId, audioMimeType, bb.config.accessToken);
          if (!effectiveText) {
            await sendWhatsApp(bb.config.phoneNumberId, bb.config.accessToken, from,
              "Couldn't transcribe that voice note. Please try again or send as text.");
            return;
          }
          console.log(`[webhook/whatsapp] Boss voice note transcribed: "${effectiveText}"`);
        }
        const refMatch = effectiveText.trim().match(/^#(\d+)[:\s]+(.+)$/s);
        if (refMatch) {
          await handleSunnyReply("whatsapp", effectiveText);
        } else {
          const reply = await runBrainQuery(effectiveText);
          await sendWhatsApp(bb.config.phoneNumberId, bb.config.accessToken, from, reply);
        }
      }
      return;
    }

    const ch = await getChannelConfig("whatsapp");
    if (!ch) return;

    // Boss self-registration via one-time code (e.g. "!boss ABC123")
    if (msgType === "text" && /^!boss\s+\S+/i.test(text)) {
      const parts = text.trim().split(/\s+/);
      const submittedCode = (parts[1] ?? "").toUpperCase();
      const [codeRow] = await db.select().from(channelConfigs)
        .where(eq(channelConfigs.channelType, "boss_register_code")).limit(1);
      let registered = false;
      if (codeRow) {
        const codeData = JSON.parse(codeRow.config) as { code: string; expiresAt: string };
        if (codeData.code === submittedCode && new Date(codeData.expiresAt) > new Date()) {
          await refreshSunnyContact("whatsapp", from);
          registered = true;
          console.log(`[boss-detect] Self-registration successful for: ${from}`);
        }
      }
      await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from,
        registered
          ? "✅ You're now registered as the boss. I'll recognise your number from now on."
          : "That code is invalid or has expired. Generate a new one from the Channels dashboard."
      );
      return;
    }

    const isBoss = await isSunnyMessage("whatsapp", from);

    if (msgType === "audio" && audioMediaId) {
      if (isBoss) {
        // Boss sent a voice note on the customer channel — transcribe and treat as text
        console.log("[webhook/whatsapp] Boss sent voice note on customer channel — transcribing");
        const transcribed = await transcribeWhatsAppAudio(audioMediaId, audioMimeType, ch.config.accessToken);
        if (!transcribed) {
          await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from,
            "Couldn't transcribe that voice note.");
          return;
        }
        const refMatch = transcribed.trim().match(/^#(\d+)[:\s]+(.+)$/s);
        if (refMatch) { await handleSunnyReply("whatsapp", transcribed); return; }
        const { reply } = await processChannelMessage("whatsapp", from, transcribed, "boss");
        await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from, reply);
      } else {
        // Customer sent a voice note — full voice note pipeline (transcribe → reply → voice)
        console.log(`[webhook/whatsapp] Customer voice note from ${from}`);
        const vnInstructions = await getVoiceNoteInstructions();
        await handleWhatsAppVoiceNote(
          audioMediaId,
          from,
          ch.config.phoneNumberId,
          ch.config.accessToken,
          async (transcribed: string) => {
            const script = detectScript(transcribed);

            // Key insight: ElevenLabs speaks a language naturally only when the TEXT
            // fed to it is in that language's script. If Zara replies in English to
            // an Urdu message, ElevenLabs tries to read English through a "foreign"
            // voice, which sounds robotic. Replying in the same script as the customer
            // means ElevenLabs receives native Urdu/Hindi text and speaks it perfectly.
            const langInstruction =
              script === "urdu"
                ? `CRITICAL — Voice note reply rules for Urdu:
1. Write your reply in Urdu using Arabic/Nastaliq script.
2. Keep proper nouns in English (names of people, countries, cities, companies, brands).
3. Keep profession titles in English (e.g. write "Engineer", "Manager", "Doctor" — not their Urdu equivalents).
4. Keep adjectives and technical/borrowed words in English where they are commonly used that way in everyday Urdu speech (e.g. "Meeting", "Schedule", "Confirm", "Email", "Link", "Plan").
5. All connecting words, sentences, verbs, and common speech must be in Urdu Nastaliq script.
6. Do NOT write in Roman Urdu. Do NOT write fully in English.
This mixed style is how educated Urdu speakers naturally communicate and is required for proper voice synthesis.`
                : script === "roman_urdu"
                ? `CRITICAL — Voice note reply rules for Roman Urdu:
1. The customer spoke in Roman Urdu (Urdu words written in English letters). Reply in Roman Urdu only.
2. Write Urdu words using English letters (e.g. "Aap ka meeting book ho gaya hai, theek hai?").
3. Keep proper nouns, brand names, and professional titles in English (e.g. "Meeting", "Email", "Manager").
4. Do NOT switch to Urdu script (Arabic/Nastaliq). Do NOT reply in formal English.
5. Match the same casual conversational tone the customer used.`
                : script === "hindi"
                ? "CRITICAL: The customer sent this voice note in Hindi. Reply in Hindi written in Devanagari script. Keep proper nouns, technical terms, and brand names in English. All common speech and connecting words must be in Devanagari. Do not write in Roman Hindi or fully in English."
                : "The customer spoke in English. Reply in English only. Do not switch to Urdu or any other language.";

            const parts = [
              langInstruction,
              vnInstructions ? `Additional instructions: ${vnInstructions}` : "",
              `Customer said: ${transcribed}`,
            ].filter(Boolean).join("\n\n");

            const { reply } = await processChannelMessage("whatsapp", from, parts, "customer");
            return reply;
          },
          async (text: string) => {
            await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from, text);
          },
        );
      }
      return;
    }

    // Text message path
    if (isBoss) {
      // Boss is messaging via the customer WhatsApp channel — refresh their contact so
      // the 24-hour session window stays open and future notifications reach them here.
      void refreshSunnyContact("whatsapp", from);
      const refMatch = text.match(/^#(\d+)[:\s]+(.+)$/s);
      if (refMatch) { await handleSunnyReply("whatsapp", text); return; }
    }
    const { reply } = await processChannelMessage("whatsapp", from, text, isBoss ? "boss" : "customer");
    await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from, reply);
  } catch (err) {
    console.error("[webhook/whatsapp] error:", err);
  }
});

router.post("/webhooks/teams", async (req, res): Promise<void> => {
  const ch = await getChannelConfig("teams");
  if (!ch) { res.sendStatus(200); return; }

  if (ch.config.hmacToken) {
    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("HMAC ")) { res.sendStatus(401); return; }
    const receivedHmac = authHeader.slice(5);
    const rawBody = JSON.stringify(req.body);
    const expectedHmac = createHmac("sha256", ch.config.hmacToken).update(rawBody).digest("base64");
    try {
      if (!timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expectedHmac))) { res.sendStatus(401); return; }
    } catch { res.sendStatus(401); return; }
  }

  interface TeamsBody { text?: string; from?: { id?: string } }
  const body = req.body as TeamsBody;
  const text = body.text?.replace(/<[^>]+>/g, "").trim();
  const userId = body.from?.id ?? "teams-user";
  if (!text) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    const isBoss = await isSunnyMessage("teams", userId);
    if (isBoss) {
      const refMatch = text.match(/^#(\d+)[:\s]+(.+)$/s);
      if (refMatch) { await handleSunnyReply("teams", text); return; }
    }
    const { reply } = await processChannelMessage("teams", userId, text, isBoss ? "boss" : "customer");
    if (ch.config.incomingWebhookUrl) await sendToTeams(ch.config.incomingWebhookUrl, reply);
  } catch (err) {
    console.error("[webhook/teams] error:", err);
  }
});

async function getBossBrainConfig(): Promise<{ platform: string; config: Record<string, string> } | null> {
  const [row] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_brain"))
    .limit(1);
  if (!row || row.status !== "connected") return null;
  try {
    const config = JSON.parse(row.config) as Record<string, string>;
    return { platform: config.platform, config };
  } catch {
    return null;
  }
}

router.post("/webhooks/boss/telegram", async (req, res): Promise<void> => {
  const ch = await getBossBrainConfig();
  if (!ch || ch.platform !== "telegram") { res.sendStatus(200); return; }

  interface TgUpdate { message?: { chat?: { id?: number }; text?: string } }
  const update = req.body as TgUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim();
  if (!chatId || !text) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    const reply = await runBrainQuery(text);
    await sendTelegram(ch.config.botToken, chatId, reply);
  } catch (err) {
    console.error("[webhook/boss/telegram] error:", err);
  }
});

router.get("/webhooks/boss/whatsapp", async (req, res): Promise<void> => {
  const ch = await getBossBrainConfig();
  if (!ch || ch.platform !== "whatsapp") { res.sendStatus(403); return; }

  interface WAQuery { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string }
  const q = req.query as WAQuery;
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === ch.config.verifyToken) {
    res.status(200).send(q["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

router.post("/webhooks/boss/whatsapp", async (req, res): Promise<void> => {
  const ch = await getBossBrainConfig();
  if (!ch || ch.platform !== "whatsapp") { res.sendStatus(200); return; }

  interface WABody { entry?: { changes?: { value?: { messages?: { from?: string; text?: { body?: string } }[] } }[] }[] }
  const body = req.body as WABody;
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = message?.from;
  const text = message?.text?.body?.trim();
  if (!from || !text) { res.sendStatus(200); return; }

  res.sendStatus(200);

  try {
    // Every time the boss messages boss_brain, refresh their contact so notifications
    // always go back to a channel where there is an active 24-hour session window.
    void refreshSunnyContact("whatsapp", from);

    const refMatch = text.trim().match(/^#(\d+)[:\s]+(.+)$/s);
    if (refMatch) {
      await handleSunnyReply("whatsapp", text);
      return;
    }

    const reply = await runBrainQuery(text);
    await sendWhatsApp(ch.config.phoneNumberId, ch.config.accessToken, from, reply);
  } catch (err) {
    console.error("[webhook/boss/whatsapp] error:", err);
  }
});

export default router;
