import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, channelConfigs, sunnyNotifications, channelSessions } from "@workspace/db";
import { randomUUID } from "crypto";
import { deliverReplyToChannel } from "./webhooks";
import { getBossContact } from "../lib/messenger";
import { connectVoiceChannel, disconnectVoiceChannel, warmElevenLabsCache } from "./voice";

const router: IRouter = Router();

const CHANNEL_TYPES = ["telegram", "slack", "whatsapp", "teams", "discord"] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

function getWebhookBase(): string {
  // WEBHOOK_BASE_URL takes priority (set to production domain e.g. https://mateos.example.com)
  if (process.env.WEBHOOK_BASE_URL) return `${process.env.WEBHOOK_BASE_URL}/api/webhooks`;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}/api/webhooks` : "http://localhost:8080/api/webhooks";
}

function sanitizeConfig(raw: string, channelType: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const safe: Record<string, string> = {};
    if (channelType === "telegram") {
      if (parsed.botUsername) safe.botUsername = parsed.botUsername;
      if (parsed.webhookRegistered) safe.webhookRegistered = parsed.webhookRegistered;
    } else if (channelType === "slack") {
      if (parsed.botName) safe.botName = parsed.botName;
      if (parsed.channelId) safe.channelId = parsed.channelId;
    } else if (channelType === "discord") {
      if (parsed.applicationId) safe.applicationId = parsed.applicationId;
      if (parsed.botUsername) safe.botUsername = parsed.botUsername;
      if (parsed.guildId) safe.guildId = parsed.guildId;
    } else if (channelType === "whatsapp") {
      if (parsed.phoneNumberId) safe.phoneNumberId = parsed.phoneNumberId;
    } else if (channelType === "teams") {
      if (parsed.connectorLabel) safe.connectorLabel = parsed.connectorLabel;
    }
    return safe;
  } catch {
    return {};
  }
}

router.get("/channels", async (_req, res): Promise<void> => {
  const rows = await db.select().from(channelConfigs);
  const webhookBase = getWebhookBase();

  const result = CHANNEL_TYPES.map((type) => {
    const row = rows.find((r) => r.channelType === type);
    return {
      channelType: type,
      status: row?.status ?? "disconnected",
      lastError: row?.lastError ?? null,
      webhookUrl: `${webhookBase}/${type}`,
      meta: row ? sanitizeConfig(row.config, type) : {},
    };
  });

  res.json(result);
});

router.get("/channels/voice/status", async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "voice"))
    .limit(1);

  if (!row) { res.json({ status: "disconnected", phoneNumber: "", greeting: "", webhookUrl: "", elevenlabsEnabled: false }); return; }

  let phoneNumber = "";
  let greeting = "";
  let voiceId = "21m00Tcm4TlvDq8ikWAM";
  let voiceName = "Rachel";
  try {
    const cfg = JSON.parse(row.config) as { phoneNumber?: string; greeting?: string; voiceId?: string; voiceName?: string };
    phoneNumber = cfg.phoneNumber ?? "";
    greeting = cfg.greeting ?? "";
    voiceId = cfg.voiceId ?? voiceId;
    voiceName = cfg.voiceName ?? voiceName;
  } catch { /* ignore */ }

  const webhookBase = process.env.WEBHOOK_BASE_URL ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const webhookUrl = webhookBase ? `${webhookBase}/api/webhooks/voice` : "";

  const elevenlabsEnabled = !!process.env.ELEVENLABS_API_KEY?.trim();

  res.json({ status: row.status, phoneNumber, greeting, webhookUrl, lastError: row.lastError, elevenlabsEnabled, voiceId, voiceName });
});

router.get("/channels/voice/elevenlabs-voices", async (_req, res): Promise<void> => {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    res.status(400).json({ error: "ELEVENLABS_API_KEY is not configured. Add it to your secrets." });
    return;
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: `ElevenLabs API error: ${text}` });
      return;
    }

    interface ElevenLabsVoice {
      voice_id: string;
      name: string;
      category: string;
      description?: string | null;
      labels?: Record<string, string> | null;
      preview_url?: string | null;
    }
    interface ElevenLabsResponse { voices: ElevenLabsVoice[] }

    const data = await response.json() as ElevenLabsResponse;

    const voices = (data.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? "other",
      description: v.description ?? null,
      labels: v.labels ?? {},
      previewUrl: v.preview_url ?? null,
    }));

    res.json({ voices });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/channels/voice/set-voice", async (req, res): Promise<void> => {
  const { voiceId, voiceName } = req.body as { voiceId?: string; voiceName?: string };

  if (!voiceId?.trim()) {
    res.status(400).json({ error: "voiceId is required" });
    return;
  }

  const [existing] = await db.select().from(channelConfigs).where(eq(channelConfigs.channelType, "voice")).limit(1);

  if (!existing) {
    res.status(400).json({ error: "Voice channel is not connected yet. Connect it first." });
    return;
  }

  let cfg: Record<string, string> = {};
  try { cfg = JSON.parse(existing.config) as Record<string, string>; } catch { /* ignore */ }

  cfg.voiceId = voiceId.trim();
  cfg.voiceName = (voiceName ?? voiceId).trim();

  await db.update(channelConfigs)
    .set({ config: JSON.stringify(cfg), updatedAt: new Date() })
    .where(eq(channelConfigs.channelType, "voice"));

  void warmElevenLabsCache();
  res.json({ success: true, voiceId: cfg.voiceId, voiceName: cfg.voiceName });
});

router.post("/channels/voice/connect", async (req, res): Promise<void> => {
  const { phoneNumber, greeting, voiceId } = req.body as { phoneNumber?: string; greeting?: string; voiceId?: string };

  if (!phoneNumber?.trim()) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  const result = await connectVoiceChannel(phoneNumber.trim(), greeting?.trim(), voiceId?.trim());

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, webhookUrl: result.webhookUrl });
});

router.post("/channels/voice/disconnect", async (_req, res): Promise<void> => {
  await disconnectVoiceChannel();
  res.json({ success: true });
});

router.post("/channels/voice/test-call", async (req, res): Promise<void> => {
  const { toNumber } = req.body as { toNumber?: string };

  if (!toNumber?.trim()) {
    res.status(400).json({ error: "toNumber is required" });
    return;
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    res.status(400).json({ error: "Twilio credentials are not configured." });
    return;
  }

  const [row] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "voice"))
    .limit(1);

  if (!row || row.status !== "connected") {
    res.status(400).json({ error: "No connected voice channel found. Connect a phone number first." });
    return;
  }

  let fromNumber = "";
  try {
    const cfg = JSON.parse(row.config) as { phoneNumber?: string };
    fromNumber = cfg.phoneNumber ?? "";
  } catch { /* ignore */ }

  if (!fromNumber) {
    res.status(400).json({ error: "Could not read the connected phone number." });
    return;
  }

  const voiceUrl = process.env.WEBHOOK_BASE_URL
    ? `${process.env.WEBHOOK_BASE_URL}/api/webhooks/voice`
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/webhooks/voice`
      : "http://localhost:8080/api/webhooks/voice";

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(sid, token);
    const call = await client.calls.create({
      to: toNumber.trim(),
      from: fromNumber,
      url: voiceUrl,
      method: "POST",
    });
    res.json({ success: true, callSid: call.sid, from: fromNumber, to: toNumber.trim() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

function generateRegisterCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

router.get("/channels/boss-register-code", async (_req, res): Promise<void> => {
  const [existing] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_register_code")).limit(1);
  if (existing) {
    const data = JSON.parse(existing.config) as { code: string; expiresAt: string };
    if (new Date(data.expiresAt) > new Date()) {
      res.json({ code: data.code, expiresAt: data.expiresAt });
      return;
    }
  }
  const code = generateRegisterCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const config = JSON.stringify({ code, expiresAt });
  if (existing) {
    await db.update(channelConfigs).set({ config, updatedAt: new Date() })
      .where(eq(channelConfigs.channelType, "boss_register_code"));
  } else {
    await db.insert(channelConfigs).values({ channelType: "boss_register_code", config, status: "connected", webhookSecret: null, lastError: null });
  }
  res.json({ code, expiresAt });
});

router.post("/channels/boss-register-code/reset", async (_req, res): Promise<void> => {
  const code = generateRegisterCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const config = JSON.stringify({ code, expiresAt });
  const [existing] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_register_code")).limit(1);
  if (existing) {
    await db.update(channelConfigs).set({ config, updatedAt: new Date() })
      .where(eq(channelConfigs.channelType, "boss_register_code"));
  } else {
    await db.insert(channelConfigs).values({ channelType: "boss_register_code", config, status: "connected", webhookSecret: null, lastError: null });
  }
  res.json({ code, expiresAt });
});

router.get("/channels/boss-brain", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_brain"))
    .limit(1);

  if (!row) {
    res.json({ status: "disconnected", platform: null, webhookUrl: null });
    return;
  }

  let config: Record<string, string> = {};
  try { config = JSON.parse(row.config) as Record<string, string>; } catch { /* ignore */ }

  const platform = config.platform ?? null;
  const webhookBase = getWebhookBase();

  const webhookUrl = platform === "whatsapp"
    ? `${webhookBase}/whatsapp`
    : platform ? `${webhookBase}/boss/${platform}` : null;

  res.json({
    status: row.status,
    platform,
    botUsername: config.botUsername ?? null,
    phoneNumberId: config.phoneNumberId ?? null,
    webhookUrl,
    verifyToken: platform === "whatsapp" ? config.verifyToken : undefined,
    sharedWebhook: platform === "whatsapp",
    lastError: row.lastError ?? null,
  });
});

router.post("/channels/boss-brain/connect", async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;
  const platform = body.platform?.trim();
  if (!platform || !["telegram", "whatsapp"].includes(platform)) {
    res.status(400).json({ error: "platform must be 'telegram' or 'whatsapp'" });
    return;
  }

  const webhookBase = getWebhookBase();
  let configObj: Record<string, string> = { platform };
  let status = "connected";
  let lastError: string | null = null;

  try {
    if (platform === "telegram") {
      const token = body.botToken?.trim();
      if (!token) { res.status(400).json({ error: "botToken is required" }); return; }

      const webhookUrl = `${webhookBase}/boss/telegram`;
      const secret = randomUUID();
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
      });
      const tgData = await tgRes.json() as { ok: boolean; description?: string };
      if (!tgData.ok) {
        status = "error";
        lastError = tgData.description ?? "Telegram webhook registration failed";
      }
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const infoData = await infoRes.json() as { ok: boolean; result?: { username?: string } };
      configObj = {
        platform,
        botToken: token,
        botUsername: infoData.ok ? (infoData.result?.username ?? "") : "",
        webhookSecret: secret,
        webhookRegistered: tgData.ok ? "true" : "false",
      };

    } else if (platform === "whatsapp") {
      const phoneNumberId = body.phoneNumberId?.trim();
      const accessToken = body.accessToken?.trim();
      const verifyToken = body.verifyToken?.trim() ?? randomUUID();
      const bossPersonalNumber = body.bossPersonalNumber?.replace(/\D/g, "").trim();
      if (!phoneNumberId || !accessToken) {
        res.status(400).json({ error: "phoneNumberId and accessToken are required" });
        return;
      }
      configObj = { platform, phoneNumberId, accessToken, verifyToken };
      if (bossPersonalNumber) {
        const contactJson = JSON.stringify({ channelType: "whatsapp", externalId: bossPersonalNumber });
        const existingContact = await db.select().from(channelConfigs)
          .where(eq(channelConfigs.channelType, "sunny_contact")).limit(1);
        if (existingContact.length > 0) {
          await db.update(channelConfigs)
            .set({ config: contactJson, status: "connected", updatedAt: new Date() })
            .where(eq(channelConfigs.channelType, "sunny_contact"));
        } else {
          await db.insert(channelConfigs).values({
            channelType: "sunny_contact",
            config: contactJson,
            status: "connected",
            webhookSecret: null,
            lastError: null,
          });
        }
        console.log(`[boss-brain/connect] Registered boss personal number: ${bossPersonalNumber}`);
      }
    }

    const existing = await db.select().from(channelConfigs)
      .where(eq(channelConfigs.channelType, "boss_brain")).limit(1);
    const configStr = JSON.stringify(configObj);

    if (existing.length > 0) {
      await db.update(channelConfigs)
        .set({ status, config: configStr, lastError, updatedAt: new Date() })
        .where(eq(channelConfigs.channelType, "boss_brain"));
    } else {
      await db.insert(channelConfigs).values({
        channelType: "boss_brain",
        status,
        config: configStr,
        webhookSecret: null,
        lastError,
      });
    }

    const safeConfig = platform === "telegram"
      ? { botUsername: configObj.botUsername, webhookRegistered: configObj.webhookRegistered }
      : { phoneNumberId: configObj.phoneNumberId, verifyToken: configObj.verifyToken };

    res.json({
      success: true,
      status,
      platform,
      webhookUrl: `${webhookBase}/boss/${platform}`,
      lastError,
      ...safeConfig,
    });
  } catch (err: unknown) {
    console.error("[boss-brain/connect] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Connection failed" });
  }
});

router.delete("/channels/boss-brain", async (_req, res): Promise<void> => {
  const [existing] = await db.select().from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_brain")).limit(1);

  if (existing) {
    try {
      const config = JSON.parse(existing.config) as Record<string, string>;
      if (config.platform === "telegram" && config.botToken) {
        await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`, { method: "POST" });
      }
    } catch { /* ignore */ }

    await db.update(channelConfigs)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(channelConfigs.channelType, "boss_brain"));
  }

  res.json({ success: true });
});

router.post("/channels/:type/connect", async (req, res): Promise<void> => {
  const type = req.params.type as ChannelType;
  if (!CHANNEL_TYPES.includes(type)) {
    res.status(400).json({ error: "Unknown channel type" });
    return;
  }

  const body = req.body as Record<string, string>;

  try {
    let configObj: Record<string, string> = {};
    let status = "connected";
    let lastError: string | null = null;
    const secret = randomUUID();

    if (type === "telegram") {
      const token = body.botToken?.trim();
      if (!token) { res.status(400).json({ error: "botToken is required" }); return; }

      const webhookUrl = `${getWebhookBase()}/telegram`;
      const tgRes = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
        }
      );
      const tgData = await tgRes.json() as { ok: boolean; description?: string };
      if (!tgData.ok) {
        status = "error";
        lastError = tgData.description ?? "Telegram webhook registration failed";
      }

      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const infoData = await infoRes.json() as { ok: boolean; result?: { username?: string } };
      const botUsername = infoData.ok ? (infoData.result?.username ?? "") : "";

      configObj = { botToken: token, botUsername, webhookRegistered: tgData.ok ? "true" : "false" };

    } else if (type === "slack") {
      const botToken = body.botToken?.trim();
      const signingSecret = body.signingSecret?.trim();
      const channelId = body.channelId?.trim();
      if (!botToken || !signingSecret) { res.status(400).json({ error: "botToken and signingSecret are required" }); return; }
      const slackRes = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      const slackData = await slackRes.json() as { ok: boolean; error?: string; bot_id?: string; team?: string };
      if (!slackData.ok) {
        status = "error";
        lastError = slackData.error ?? "Slack token validation failed";
      }
      configObj = { botToken, signingSecret, channelId: channelId ?? "", botName: slackData.team ?? "" };

    } else if (type === "discord") {
      const botToken = body.botToken?.trim();
      const applicationId = body.applicationId?.trim();
      const publicKey = body.publicKey?.trim();
      const guildId = body.guildId?.trim() ?? "";
      if (!botToken || !applicationId || !publicKey) {
        res.status(400).json({ error: "botToken, applicationId, and publicKey are required" });
        return;
      }
      const discordRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${botToken}` },
      });
      const discordData = await discordRes.json() as { id?: string; username?: string; message?: string };
      if (!discordData.id) {
        status = "error";
        lastError = discordData.message ?? "Discord bot token validation failed";
      }
      configObj = { botToken, applicationId, publicKey, guildId, botUsername: discordData.username ?? "" };

    } else if (type === "whatsapp") {
      const phoneNumberId = body.phoneNumberId?.trim();
      const accessToken = body.accessToken?.trim();
      const verifyToken = body.verifyToken?.trim() ?? randomUUID();
      if (!phoneNumberId || !accessToken) {
        res.status(400).json({ error: "phoneNumberId and accessToken are required" });
        return;
      }
      configObj = { phoneNumberId, accessToken, verifyToken };

    } else if (type === "teams") {
      const incomingWebhookUrl = body.incomingWebhookUrl?.trim();
      const hmacToken = body.hmacToken?.trim() ?? "";
      if (!incomingWebhookUrl) { res.status(400).json({ error: "incomingWebhookUrl is required" }); return; }
      configObj = { incomingWebhookUrl, hmacToken, connectorLabel: body.connectorLabel?.trim() ?? "MateOS Brain" };
    }

    const existing = await db.select().from(channelConfigs).where(eq(channelConfigs.channelType, type)).limit(1);
    const configStr = JSON.stringify(configObj);

    if (existing.length > 0) {
      await db.update(channelConfigs)
        .set({ status, config: configStr, webhookSecret: secret, lastError, updatedAt: new Date() })
        .where(eq(channelConfigs.channelType, type));
    } else {
      await db.insert(channelConfigs).values({
        channelType: type,
        status,
        config: configStr,
        webhookSecret: secret,
        lastError,
      });
    }

    res.json({ success: true, status, webhookUrl: `${getWebhookBase()}/${type}`, lastError });
  } catch (err: unknown) {
    console.error(`Channel connect error [${type}]:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Connection failed" });
  }
});

router.post("/channels/:type/disconnect", async (req, res): Promise<void> => {
  const type = req.params.type as ChannelType;
  if (!CHANNEL_TYPES.includes(type)) {
    res.status(400).json({ error: "Unknown channel type" });
    return;
  }

  const existing = await db.select().from(channelConfigs).where(eq(channelConfigs.channelType, type)).limit(1);

  if (type === "telegram" && existing.length > 0) {
    try {
      const config = JSON.parse(existing[0].config) as Record<string, string>;
      if (config.botToken) {
        await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`);
      }
    } catch { /* ignore */ }
  }

  if (existing.length > 0) {
    await db.update(channelConfigs)
      .set({ status: "disconnected", webhookSecret: null, lastError: null, updatedAt: new Date() })
      .where(eq(channelConfigs.channelType, type));
  }

  res.json({ success: true });
});

router.get("/channels/sunny-contact", async (_req, res): Promise<void> => {
  const contact = await getBossContact();
  res.json(contact ?? { channelType: "", externalId: "" });
});

router.post("/channels/sunny-contact", async (req, res): Promise<void> => {
  const { channelType, externalId } = req.body as { channelType?: string; externalId?: string };

  if (!channelType || !externalId?.trim()) {
    res.status(400).json({ error: "channelType and externalId are required" });
    return;
  }

  const existing = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "sunny_contact"))
    .limit(1);

  // For WhatsApp, normalize to digits-only so any format the user types always matches
  const normalizedId = channelType === "whatsapp"
    ? externalId.replace(/\D/g, "")
    : externalId.trim();
  const configJson = JSON.stringify({ channelType, externalId: normalizedId });

  if (existing.length > 0) {
    await db
      .update(channelConfigs)
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

  res.json({ success: true });
});

router.delete("/channels/sunny-contact", async (_req, res): Promise<void> => {
  await db
    .update(channelConfigs)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(eq(channelConfigs.channelType, "sunny_contact"));
  res.json({ success: true });
});

router.get("/channels/notifications", async (req, res): Promise<void> => {
  const all = (req.query as Record<string, string>).view === "all";

  const notifications = await db
    .select()
    .from(sunnyNotifications)
    .orderBy(desc(sunnyNotifications.createdAt));

  const needsAction = (n: { status: string }) =>
    n.status === "pending" || n.status === "delivery_failed";

  if (all) {
    res.json({ all: notifications, pendingCount: notifications.filter(needsAction).length });
    return;
  }

  const pending = notifications.filter(needsAction);
  const recent = notifications.filter((n) => !needsAction(n)).slice(0, 10);

  res.json({ pending, recent, pendingCount: pending.length });
});

router.post("/channels/notifications/:id/reply", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { reply } = req.body as { reply?: string };

  if (!reply?.trim()) {
    res.status(400).json({ error: "reply is required" });
    return;
  }

  const [notification] = await db
    .select()
    .from(sunnyNotifications)
    .where(eq(sunnyNotifications.id, id))
    .limit(1);

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  await db
    .update(sunnyNotifications)
    .set({ status: "replied", sunnyReply: reply.trim(), updatedAt: new Date() })
    .where(eq(sunnyNotifications.id, id));

  await db
    .update(channelSessions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(channelSessions.id, Number(notification.sessionId)));

  try {
    await deliverReplyToChannel(
      notification.channelType,
      notification.externalId,
      reply.trim(),
    );
  } catch (err) {
    console.error("[notifications/reply] delivery error:", err);
  }

  res.json({ success: true });
});

router.post("/channels/notifications/:id/dismiss", async (req, res): Promise<void> => {
  const id = Number(req.params.id);

  const [notification] = await db
    .select()
    .from(sunnyNotifications)
    .where(eq(sunnyNotifications.id, id))
    .limit(1);

  if (!notification) { res.status(404).json({ error: "Not found" }); return; }

  await db
    .update(sunnyNotifications)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(sunnyNotifications.id, id));

  await db
    .update(channelSessions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(channelSessions.id, Number(notification.sessionId)));

  res.json({ success: true });
});

export default router;
