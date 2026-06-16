import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import twilio from "twilio";
import { db, channelConfigs, channelSessions, preferencesTable } from "@workspace/db";
import { runChannelBrainQuery } from "../brain/engine";

const router: IRouter = Router();

const FALLBACK_VOICE = "Polly.Joanna-Neural";
const LANGUAGE = "en-US";
const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

function getWebhookBase(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  return domain
    ? `https://${domain}/api/webhooks`
    : "http://localhost:8080/api/webhooks";
}

const audioBuffers = new Map<string, Buffer>();
const staticAudioCache = new Map<string, string>();

async function generateElevenLabsSpeech(
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

function getElevenLabsKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

async function getVoiceConfig(): Promise<{ greeting: string; voiceId: string }> {
  const [row] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "voice"))
    .limit(1);

  const [prefRow] = await db.select().from(preferencesTable).limit(1);
  const botName = (prefRow as any)?.botName ?? "Mate";
  const bossName = prefRow?.bossName ?? "Owner";
  let greeting = `Hey there! This is ${botName}, calling on behalf of ${bossName}. How's it going? What can I help you with today?`;
  let voiceId = ELEVENLABS_DEFAULT_VOICE;

  try {
    if (row?.config) {
      const cfg = JSON.parse(row.config) as { greeting?: string; voiceId?: string };
      if (cfg.greeting) greeting = cfg.greeting;
      if (cfg.voiceId) voiceId = cfg.voiceId;
    }
  } catch { /* ignore */ }

  return { greeting, voiceId };
}

const STATIC_PHRASES = [
  "Sure, one moment.",
  "Sorry, I didn't catch that. Go ahead whenever you're ready.",
  "It was so great talking with you! Have a wonderful day. Take care.",
];

export async function warmElevenLabsCache(): Promise<void> {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return;
  try {
    const { greeting, voiceId } = await getVoiceConfig();
    const phrases = [greeting, ...STATIC_PHRASES];
    await Promise.allSettled(phrases.map((p) => getStaticAudio(p, voiceId)));
    console.log("[voice] ElevenLabs cache warmed for", phrases.length, "phrases");
  } catch (err) {
    console.warn("[voice] cache warm failed:", err);
  }
}

setTimeout(() => { void warmElevenLabsCache(); }, 5000);

async function storeAudio(buffer: Buffer, ttlMs = 300_000): Promise<string> {
  const id = randomUUID();
  audioBuffers.set(id, buffer);
  setTimeout(() => audioBuffers.delete(id), ttlMs);
  return id;
}

async function getStaticAudio(text: string, voiceId: string): Promise<string | null> {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return null;

  const cacheKey = `${voiceId}:${text}`;
  const cached = staticAudioCache.get(cacheKey);
  if (cached && audioBuffers.has(cached)) return cached;

  try {
    const buf = await generateElevenLabsSpeech(text, apiKey, voiceId);
    const id = randomUUID();
    audioBuffers.set(id, buf);
    staticAudioCache.set(cacheKey, id);
    return id;
  } catch (err) {
    console.error("[TTS] static generation failed:", err);
    return null;
  }
}

function twimlPlay(audioUrl: string, gatherUrl: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ["speech"],
    action: gatherUrl,
    speechTimeout: "auto",
    language: LANGUAGE,
    profanityFilter: false,
  });
  gather.play(audioUrl);
  twiml.redirect(gatherUrl);
  return twiml.toString();
}

function twimlSay(text: string, gatherUrl: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: ["speech"],
    action: gatherUrl,
    speechTimeout: "auto",
    language: LANGUAGE,
    profanityFilter: false,
  });
  gather.say({ voice: FALLBACK_VOICE }, text);
  twiml.redirect(gatherUrl);
  return twiml.toString();
}

function twimlPlayThinking(thinkingUrl: string | null, redirectUrl: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  if (thinkingUrl) {
    twiml.play(thinkingUrl);
  } else {
    twiml.say({ voice: FALLBACK_VOICE }, "One moment please.");
  }
  twiml.pause({ length: 1 });
  twiml.redirect({ method: "POST" }, redirectUrl);
  return twiml.toString();
}

function twimlPoll(redirectUrl: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.pause({ length: 2 });
  twiml.redirect({ method: "POST" }, redirectUrl);
  return twiml.toString();
}

function twimlBye(text: string, audioUrl: string | null): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  if (audioUrl) {
    twiml.play(audioUrl);
  } else {
    twiml.say({ voice: FALLBACK_VOICE }, text);
  }
  twiml.hangup();
  return twiml.toString();
}

type SessionMessage = { role: string; content: string };

async function getOrCreateVoiceSession(callSid: string) {
  const [existing] = await db
    .select()
    .from(channelSessions)
    .where(and(eq(channelSessions.channelType, "voice"), eq(channelSessions.externalId, callSid)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(channelSessions)
    .values({ channelType: "voice", externalId: callSid, messages: "[]", status: "active" })
    .returning();

  return created;
}

async function appendToSession(sessionId: number, newMessages: SessionMessage[]) {
  const [session] = await db.select().from(channelSessions).where(eq(channelSessions.id, sessionId)).limit(1);
  if (!session) return;
  let history: SessionMessage[] = [];
  try { history = JSON.parse(session.messages) as SessionMessage[]; } catch { /* ignore */ }
  history.push(...newMessages);
  await db
    .update(channelSessions)
    .set({ messages: JSON.stringify(history.slice(-30)), updatedAt: new Date() })
    .where(eq(channelSessions.id, sessionId));
}

type PendingReply =
  | { kind: "polly"; text: string }
  | { kind: "audio"; audioId: string };

const pendingReplies = new Map<string, PendingReply>();

router.get("/webhooks/voice/audio/:id", (req, res): void => {
  const buffer = audioBuffers.get(req.params.id);
  if (!buffer) { res.status(404).send("Not found"); return; }
  res.type("audio/mpeg").set("Cache-Control", "no-cache").send(buffer);
});

router.post("/webhooks/voice", (req, res): void => {
  console.log("[voice] incoming call – routing to AI voice bridge");

  const host = (req.headers["x-forwarded-host"] as string | undefined)
    ?? (req.headers.host as string | undefined)
    ?? process.env.REPLIT_DEV_DOMAIN
    ?? "localhost:8080";

  const callerPhone = (req.body as { From?: string }).From ?? "";
  const streamUrl = `wss://${host}/api/webhooks/voice/stream?caller=${encodeURIComponent(callerPhone)}`;
  console.log("[voice] stream URL:", streamUrl, "caller:", callerPhone);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: streamUrl });

  res.type("text/xml").send(twiml.toString());
});

function getCachedAudioUrl(text: string, voiceId: string): string | null {
  const cacheKey = `${voiceId}:${text}`;
  const cachedId = staticAudioCache.get(cacheKey);
  if (cachedId && audioBuffers.has(cachedId)) {
    return `${getWebhookBase()}/voice/audio/${cachedId}`;
  }
  return null;
}

router.post("/webhooks/voice/gather", async (req, res): Promise<void> => {
  console.log("[voice/gather] body:", JSON.stringify(req.body));

  const gatherUrl = `${getWebhookBase()}/voice/gather`;
  const respondUrl = `${getWebhookBase()}/voice/respond`;

  interface TwilioGatherBody {
    SpeechResult?: string;
    Confidence?: string;
    CallSid?: string;
  }
  const body = req.body as TwilioGatherBody;
  const speechResult = body.SpeechResult?.trim();
  const confidence = parseFloat(body.Confidence ?? "1");
  const callSid = body.CallSid ?? "unknown";

  console.log("[voice/gather] speechResult:", speechResult, "confidence:", confidence, "callSid:", callSid);

  const { voiceId } = await getVoiceConfig();
  const apiKey = getElevenLabsKey();

  const fallback = "Sorry, I didn't catch that. Go ahead whenever you're ready.";

  if (!speechResult || confidence < 0.15) {
    if (speechResult && confidence < 0.15) {
      console.log("[voice/gather] low confidence, ignoring:", speechResult, "@", confidence);
    }
    const cachedUrl = apiKey ? getCachedAudioUrl(fallback, voiceId) : null;
    if (cachedUrl) {
      res.type("text/xml").send(twimlPlay(cachedUrl, gatherUrl));
    } else {
      res.type("text/xml").send(twimlSay(fallback, gatherUrl));
      if (apiKey) void getStaticAudio(fallback, voiceId);
    }
    return;
  }

  const lowered = speechResult.toLowerCase();
  if (["bye", "goodbye", "hang up", "end call", "that's all", "thank you bye"].some((w) => lowered.includes(w))) {
    const byeText = "It was so great talking with you! Have a wonderful day. Take care.";
    const cachedByeUrl = apiKey ? getCachedAudioUrl(byeText, voiceId) : null;
    res.type("text/xml").send(twimlBye(byeText, cachedByeUrl));
    if (apiKey && !cachedByeUrl) void getStaticAudio(byeText, voiceId);
    return;
  }

  const thinkingText = "Sure, one moment.";
  const thinkingUrl = apiKey ? getCachedAudioUrl(thinkingText, voiceId) : null;
  if (apiKey && !thinkingUrl) void getStaticAudio(thinkingText, voiceId);

  const respondTarget = `${respondUrl}?callSid=${encodeURIComponent(callSid)}`;
  res.type("text/xml").send(twimlPlayThinking(thinkingUrl, respondTarget));

  try {
    const session = await getOrCreateVoiceSession(callSid);
    let history: SessionMessage[] = [];
    try { history = JSON.parse(session.messages) as SessionMessage[]; } catch { /* ignore */ }

    const [prefs] = await db.select().from(preferencesTable).limit(1);
    const { reply } = await runChannelBrainQuery(speechResult, history, "voice", callSid, session.id, prefs?.toolConfig);

    await appendToSession(session.id, [
      { role: "user", content: speechResult },
      { role: "assistant", content: reply },
    ]);

    const cleaned = reply
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#+\s/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/\n+/g, " ")
      .trim();

    if (apiKey) {
      try {
        const buf = await generateElevenLabsSpeech(cleaned, apiKey, voiceId);
        const audioId = await storeAudio(buf);
        pendingReplies.set(callSid, { kind: "audio", audioId });
      } catch (err) {
        console.error("[TTS] ElevenLabs failed for reply, falling back to Polly:", err);
        pendingReplies.set(callSid, { kind: "polly", text: cleaned });
      }
    } else {
      pendingReplies.set(callSid, { kind: "polly", text: cleaned });
    }

    setTimeout(() => pendingReplies.delete(callSid), 120_000);
  } catch (err) {
    console.error("[voice/gather] error:", err);
    const errText = "I ran into a small hiccup. Could you try saying that again?";
    if (apiKey) {
      try {
        const buf = await generateElevenLabsSpeech(errText, apiKey, voiceId);
        const audioId = await storeAudio(buf);
        pendingReplies.set(callSid, { kind: "audio", audioId });
      } catch {
        pendingReplies.set(callSid, { kind: "polly", text: errText });
      }
    } else {
      pendingReplies.set(callSid, { kind: "polly", text: errText });
    }
    setTimeout(() => pendingReplies.delete(callSid), 120_000);
  }
});

router.post("/webhooks/voice/respond", async (req, res): Promise<void> => {
  const qs = req.query as { callSid?: string };
  const callSid = (req.body as { CallSid?: string }).CallSid ?? qs.callSid ?? "unknown";

  console.log("[voice/respond] callSid:", callSid);

  const gatherUrl = `${getWebhookBase()}/voice/gather`;
  const respondUrl = `${getWebhookBase()}/voice/respond`;
  const pending = pendingReplies.get(callSid);

  if (!pending) {
    res.type("text/xml").send(twimlPoll(`${respondUrl}?callSid=${encodeURIComponent(callSid)}`));
    return;
  }

  pendingReplies.delete(callSid);

  if (pending.kind === "audio") {
    const audioUrl = `${getWebhookBase()}/voice/audio/${pending.audioId}`;
    res.type("text/xml").send(twimlPlay(audioUrl, gatherUrl));
  } else {
    res.type("text/xml").send(twimlSay(pending.text, gatherUrl));
  }
});

router.post("/webhooks/voice/status", async (req, res): Promise<void> => {
  interface StatusBody { CallSid?: string; CallStatus?: string }
  const body = req.body as StatusBody;
  console.log("[voice/status] CallSid:", body.CallSid, "status:", body.CallStatus);
  if (body.CallStatus === "completed" || body.CallStatus === "failed") {
    if (body.CallSid) {
      pendingReplies.delete(body.CallSid);
    }
    try {
      await db
        .update(channelSessions)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(channelSessions.channelType, "voice"), eq(channelSessions.externalId, body.CallSid ?? "")));
    } catch { /* ignore */ }
  }
  res.sendStatus(200);
});

export async function connectVoiceChannel(
  phoneNumber: string,
  greeting?: string,
  voiceId?: string,
): Promise<{ success: boolean; error?: string; webhookUrl: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    return { success: false, error: "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required.", webhookUrl: "" };
  }

  const webhookBase = getWebhookBase();
  const voiceUrl = `${webhookBase}/voice`;
  const statusUrl = `${webhookBase}/voice/status`;

  try {
    const client = twilio(sid, token);

    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
    if (numbers.length === 0) {
      return { success: false, error: `Phone number ${phoneNumber} not found in your Twilio account.`, webhookUrl: voiceUrl };
    }

    await client.incomingPhoneNumbers(numbers[0].sid).update({
      voiceUrl,
      voiceMethod: "POST",
      statusCallback: statusUrl,
      statusCallbackMethod: "POST",
    });

    const existing = await db.select().from(channelConfigs).where(eq(channelConfigs.channelType, "voice")).limit(1);
    const config = JSON.stringify({
      phoneNumber,
      greeting: greeting ?? "Hey there! How can I help you today?",
      voiceId: voiceId ?? ELEVENLABS_DEFAULT_VOICE,
    });

    if (existing.length > 0) {
      await db.update(channelConfigs)
        .set({ config, status: "connected", lastError: null, updatedAt: new Date() })
        .where(eq(channelConfigs.channelType, "voice"));
    } else {
      await db.insert(channelConfigs).values({
        channelType: "voice",
        config,
        status: "connected",
        webhookSecret: null,
        lastError: null,
      });
    }

    void warmElevenLabsCache();
    return { success: true, webhookUrl: voiceUrl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(channelConfigs)
      .set({ status: "error", lastError: message, updatedAt: new Date() })
      .where(eq(channelConfigs.channelType, "voice"))
      .catch(() => { /* ignore */ });
    return { success: false, error: message, webhookUrl: "" };
  }
}

export async function disconnectVoiceChannel(): Promise<void> {
  await db
    .update(channelConfigs)
    .set({ status: "disconnected", lastError: null, updatedAt: new Date() })
    .where(eq(channelConfigs.channelType, "voice"));
}

export async function callBossOutbound(bossPhone: string): Promise<{ success: boolean; callSid?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    return { success: false, error: "Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing)." };
  }

  const [voiceConfig] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "voice"))
    .limit(1);

  if (!voiceConfig || voiceConfig.status !== "connected") {
    return { success: false, error: "Voice channel is not connected. Set up a Twilio phone number first." };
  }

  let twilioNumber = "";
  try {
    const cfg = JSON.parse(voiceConfig.config ?? "{}") as { phoneNumber?: string };
    twilioNumber = cfg.phoneNumber ?? "";
  } catch { /* ignore */ }

  if (!twilioNumber) {
    return { success: false, error: "No Twilio phone number is configured on the voice channel." };
  }

  const host = process.env.REPLIT_DEV_DOMAIN ?? "localhost:8080";
  const streamUrl = `wss://${host}/api/webhooks/voice/stream?caller=${encodeURIComponent(bossPhone)}`;

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: streamUrl });
  const twimlStr = twiml.toString();

  try {
    const client = twilio(sid, token);
    const call = await client.calls.create({
      to: bossPhone,
      from: twilioNumber,
      twiml: twimlStr,
    });
    console.log(`[voice] Outbound boss call initiated: ${call.sid} → ${bossPhone}`);
    return { success: true, callSid: call.sid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[voice] Outbound boss call failed:", message);
    return { success: false, error: message };
  }
}

router.post("/voice/call-boss", async (req, res): Promise<void> => {
  const { bossPhone } = req.body as { bossPhone?: string };
  if (!bossPhone) {
    res.status(400).json({ error: "bossPhone is required" });
    return;
  }
  const result = await callBossOutbound(bossPhone);
  if (result.success) {
    res.json({ success: true, callSid: result.callSid });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

export default router;
