import { Router, type Request, type Response } from "express";
import { db, preferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runBrainQuery } from "../brain/engine";

const router = Router();

async function getPrefs() {
  const rows = await db.select().from(preferencesTable).limit(1);
  return rows[0] ?? null;
}

async function tgCall(token: string, method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35000),
  });
  const json = await res.json() as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
  return json.result;
}

let pollingActive = false;
let pollingAbort: AbortController | null = null;
let updateOffset = 0;

async function sendTgMessage(token: string, chatId: string, text: string) {
  await tgCall(token, "sendMessage", { chat_id: chatId, text });
}

async function pollLoop(token: string, initialChatId: string) {
  pollingActive = true;
  let chatId = initialChatId;

  while (pollingActive) {
    try {
      pollingAbort = new AbortController();
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: updateOffset, timeout: 30, allowed_updates: ["message"] }),
        signal: AbortSignal.timeout(38000),
      });
      const json = await res.json() as { ok: boolean; result?: Array<{
        update_id: number;
        message?: { chat: { id: number }; from?: { first_name?: string; username?: string }; text?: string };
      }> };

      if (!json.ok || !Array.isArray(json.result)) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const update of json.result) {
        updateOffset = Math.max(updateOffset, update.update_id + 1);
        const msg = update.message;
        if (!msg) continue;

        const incomingChatId = String(msg.chat.id);

        if (!chatId) {
          chatId = incomingChatId;
          const prefs = await getPrefs();
          if (prefs) {
            await db.update(preferencesTable)
              .set({ brainTelegramChatId: chatId })
              .where(eq(preferencesTable.id, prefs.id));
          }
          console.log("[brain-telegram] Auto-detected chat_id:", chatId);
        }

        if (incomingChatId !== chatId) continue;

        const text = msg.text;
        if (!text) continue;

        const senderName = msg.from?.first_name ?? msg.from?.username ?? "User";
        console.log(`[brain-telegram] Message from ${senderName}: ${text.slice(0, 100)}`);

        try {
          const reply = await runBrainQuery(text);
          await sendTgMessage(token, chatId, reply);
        } catch (err) {
          console.error("[brain-telegram] Reply error:", err);
        }
      }
    } catch (err) {
      if (!pollingActive) break;
      console.error("[brain-telegram] Poll error:", err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

function stopPolling() {
  pollingActive = false;
  pollingAbort?.abort();
  pollingAbort = null;
}

function startPolling(token: string, chatId: string) {
  stopPolling();
  updateOffset = 0;
  pollLoop(token, chatId).catch(err => console.error("[brain-telegram] Poll loop crashed:", err));
}

async function initTelegram() {
  try {
    const prefs = await getPrefs();
    if (prefs?.brainTelegramToken) {
      console.log("[brain-telegram] Resuming polling...");
      startPolling(prefs.brainTelegramToken, prefs.brainTelegramChatId ?? "");
    }
  } catch (err) {
    console.error("[brain-telegram] Init error:", err);
  }
}

setTimeout(initTelegram, 3000);

router.get("/brain/telegram-status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const prefs = await getPrefs();
    if (!prefs?.brainTelegramToken) {
      res.json({ connected: false, pending: false });
      return;
    }

    try {
      const botInfo = await tgCall(prefs.brainTelegramToken, "getMe") as {
        username?: string;
        first_name?: string;
      };
      const botName = botInfo.username ? `@${botInfo.username}` : (botInfo.first_name ?? "Bot");

      if (!prefs.brainTelegramChatId) {
        res.json({ connected: false, pending: true, botName });
        return;
      }

      res.json({ connected: true, botName, chatId: prefs.brainTelegramChatId });
    } catch {
      res.json({ connected: false, pending: false, error: "Invalid token" });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/brain/telegram-connect", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body as { token?: string };
    if (!token?.trim()) {
      res.status(400).json({ error: "Bot token is required" });
      return;
    }

    let botInfo: { username?: string; first_name?: string };
    try {
      botInfo = await tgCall(token.trim(), "getMe") as typeof botInfo;
    } catch {
      res.status(400).json({ error: "Invalid bot token — get one from @BotFather" });
      return;
    }

    const botName = botInfo.username ? `@${botInfo.username}` : (botInfo.first_name ?? "Bot");
    const prefs = await getPrefs();

    await db.update(preferencesTable)
      .set({ brainTelegramToken: token.trim(), brainTelegramChatId: "" })
      .where(eq(preferencesTable.id, prefs!.id));

    startPolling(token.trim(), "");

    res.json({ botName, pending: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/brain/telegram-disconnect", async (_req: Request, res: Response): Promise<void> => {
  try {
    stopPolling();
    const prefs = await getPrefs();
    await db.update(preferencesTable)
      .set({ brainTelegramToken: "", brainTelegramChatId: "" })
      .where(eq(preferencesTable.id, prefs!.id));
    res.json({ connected: false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
