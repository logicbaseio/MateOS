import { eq } from "drizzle-orm";
import { db, channelConfigs } from "@workspace/db";

const BOSS_CONTACT_CHANNEL_TYPES = ["boss_contact", "sunny_contact"] as const;

export interface BossContact {
  channelType: string;
  externalId: string;
}

export async function getBossContact(): Promise<BossContact | null> {
  for (const channelType of BOSS_CONTACT_CHANNEL_TYPES) {
    const [row] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.channelType, channelType))
      .limit(1);

    if (!row) continue;

    try {
      const cfg = JSON.parse(row.config) as BossContact;
      if (cfg.channelType && cfg.externalId) return cfg;
    } catch { /* ignore */ }
  }
  return null;
}

async function getChannelToken(type: string, requireConnected = true): Promise<Record<string, string> | null> {
  const [row] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, type))
    .limit(1);
  if (!row) return null;
  if (requireConnected && row.status !== "connected") return null;
  try { return JSON.parse(row.config) as Record<string, string>; } catch { return null; }
}

export async function sendTelegram(token: string, chatId: number | string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

export async function sendSlack(token: string, channelId: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, text }),
  });
}

export async function sendDiscordFollowup(appId: string, token: string, text: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
}

export async function sendWhatsApp(phoneNumberId: string, accessToken: string, to: string, text: string): Promise<boolean> {
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[sendWhatsApp] FAILED phoneId=${phoneNumberId} to=${to} status=${res.status}: ${body}`);
    return false;
  } else {
    console.log(`[sendWhatsApp] OK phoneId=${phoneNumberId} to=${to}`);
    return true;
  }
}

export async function sendToTeams(webhookUrl: string, text: string): Promise<void> {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function deliverToChannel(
  channelType: string,
  externalId: string,
  text: string,
  bypassConnectedCheck = false,
): Promise<void> {
  const cfg = await getChannelToken(channelType, !bypassConnectedCheck);
  if (!cfg) return;

  try {
    if (channelType === "telegram") {
      await sendTelegram(cfg.botToken, externalId, text);
    } else if (channelType === "slack") {
      await sendSlack(cfg.botToken, externalId, text);
    } else if (channelType === "whatsapp") {
      await sendWhatsApp(cfg.phoneNumberId, cfg.accessToken, externalId, text);
    } else if (channelType === "teams") {
      if (cfg.incomingWebhookUrl) await sendToTeams(cfg.incomingWebhookUrl, text);
    }
  } catch (err) {
    console.error(`[messenger/deliverToChannel/${channelType}] error:`, err);
  }
}

async function getWhatsAppSendingCredentials(): Promise<Record<string, string> | null> {
  const customerCfg = await getChannelToken("whatsapp", false);
  if (customerCfg?.phoneNumberId && customerCfg?.accessToken) return customerCfg;

  const [bbRow] = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelType, "boss_brain"))
    .limit(1);
  if (!bbRow) return null;
  try {
    const bbCfg = JSON.parse(bbRow.config) as Record<string, string>;
    if (bbCfg.platform === "whatsapp" && bbCfg.phoneNumberId && bbCfg.accessToken) return bbCfg;
  } catch { /* ignore */ }
  return null;
}

export async function deliverMessageToBoss(text: string): Promise<boolean> {
  const contact = await getBossContact();
  if (!contact) {
    console.warn("[messenger/deliverMessageToBoss] No boss_contact configured — notification not delivered");
    return false;
  }

  try {
    if (contact.channelType === "telegram") {
      const cfg = await getChannelToken("telegram", false);
      if (!cfg?.botToken) { console.warn("[messenger/deliverMessageToBoss] No Telegram config"); return false; }
      await sendTelegram(cfg.botToken, contact.externalId, text);
      return true;
    } else if (contact.channelType === "slack") {
      const cfg = await getChannelToken("slack", false);
      if (!cfg?.botToken) { console.warn("[messenger/deliverMessageToBoss] No Slack config"); return false; }
      await sendSlack(cfg.botToken, contact.externalId, text);
      return true;
    } else if (contact.channelType === "whatsapp") {
      const cfg = await getWhatsAppSendingCredentials();
      if (!cfg) { console.warn("[messenger/deliverMessageToBoss] No WhatsApp credentials available"); return false; }
      const ok = await sendWhatsApp(cfg.phoneNumberId, cfg.accessToken, contact.externalId, text);
      if (!ok) {
        console.error(`[messenger/deliverMessageToBoss] WhatsApp delivery failed to ${contact.externalId}. Likely cause: no active 24-hour session window (boss must message the bot first) or expired token.`);
      }
      return ok;
    } else if (contact.channelType === "teams") {
      const cfg = await getChannelToken("teams", false);
      if (cfg?.incomingWebhookUrl) { await sendToTeams(cfg.incomingWebhookUrl, text); return true; }
      return false;
    }
  } catch (err) {
    console.error("[messenger/deliverMessageToBoss] error:", err);
  }
  return false;
}
