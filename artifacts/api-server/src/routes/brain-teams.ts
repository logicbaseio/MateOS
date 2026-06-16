import { Router, type IRouter, type Request, type Response } from "express";
import { db, preferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getValidToken, graphGet, graphPost, graphPatch, graphDelete } from "./microsoft";
import { runBrainQuery } from "../brain/engine";

const router: IRouter = Router();

function getBaseUrl(): string {
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "https://mateos.example.com";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

async function getPrefs() {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  return prefs;
}

async function getMyUserId(token: string): Promise<string | null> {
  try {
    const me = await graphGet("/me?$select=id", token) as { id: string };
    return me.id;
  } catch {
    return null;
  }
}

async function createSubscription(resource: string, token: string): Promise<{ id: string; expirationDateTime: string }> {
  const notificationUrl = `${getBaseUrl()}/api/brain/teams-webhook`;
  const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();
  const sub = await graphPost("/subscriptions", {
    changeType: "created",
    notificationUrl,
    resource,
    expirationDateTime,
    clientState: "brain-teams",
  }, token) as { id: string; expirationDateTime: string };
  return sub;
}

async function maybeRenew(): Promise<void> {
  const prefs = await getPrefs();
  if (!prefs?.brainTeamsSubId || !prefs?.brainTeamsSubExpiry) return;
  const msUntilExpiry = new Date(prefs.brainTeamsSubExpiry).getTime() - Date.now();
  if (msUntilExpiry > 15 * 60 * 1000) return;

  const token = await getValidToken();
  if (!token) return;
  try {
    const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    await graphPatch(`/subscriptions/${prefs.brainTeamsSubId}`, { expirationDateTime }, token);
    await db.update(preferencesTable)
      .set({ brainTeamsSubExpiry: new Date(expirationDateTime) })
      .where(eq(preferencesTable.id, prefs.id));
    console.log("[brain-teams] Subscription renewed");
  } catch (err) {
    console.error("[brain-teams] Failed to renew subscription:", err);
  }
}

router.get("/brain/teams-status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const prefs = await getPrefs();
    if (!prefs?.brainTeamsChatId) {
      res.json({ connected: false, chatId: null, type: "chat" });
      return;
    }

    const expiry = prefs.brainTeamsSubExpiry ? new Date(prefs.brainTeamsSubExpiry) : null;
    const isActive = expiry ? expiry > new Date() : false;
    const type = (prefs.brainTeamsType as "chat" | "channel") ?? "chat";

    let chatName: string | null = null;
    const token = await getValidToken();
    if (token && prefs.brainTeamsChatId) {
      try {
        if (type === "channel" && prefs.brainTeamsTeamId) {
          const channel = await graphGet(
            `/teams/${prefs.brainTeamsTeamId}/channels/${prefs.brainTeamsChatId}`,
            token,
          ) as { displayName?: string };
          const team = await graphGet(
            `/teams/${prefs.brainTeamsTeamId}?$select=displayName`,
            token,
          ) as { displayName?: string };
          chatName = `${team.displayName ?? "Team"} › ${channel.displayName ?? "Channel"}`;
        } else {
          const chat = await graphGet(
            `/me/chats/${prefs.brainTeamsChatId}?$expand=members&$select=id,topic,chatType,members`,
            token,
          ) as { topic?: string; chatType?: string; members?: Array<{ displayName?: string; userId?: string }> };
          chatName = chat.topic ?? null;
          if (!chatName && chat.chatType === "oneOnOne" && chat.members) {
            const myId = await getMyUserId(token);
            const other = chat.members.find(m => m.userId !== myId);
            chatName = other?.displayName ?? chat.members.map(m => m.displayName).filter(Boolean).join(", ") ?? null;
          }
        }
      } catch {
        chatName = null;
      }
    }

    res.json({
      connected: isActive,
      chatId: prefs.brainTeamsChatId,
      teamId: prefs.brainTeamsTeamId ?? null,
      type,
      chatName,
      subscriptionId: prefs.brainTeamsSubId ?? null,
      expiresAt: expiry?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/brain/teams-options", async (_req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) {
    res.status(401).json({ error: "Microsoft account not connected" });
    return;
  }
  try {
    const myId = await getMyUserId(token);

    const [chatsData, teamsData] = await Promise.all([
      graphGet("/me/chats?$expand=members&$select=id,topic,chatType,members&$top=30", token) as Promise<{ value: Array<{ id: string; topic?: string; chatType?: string; members?: Array<{ displayName?: string; userId?: string }> }> }>,
      graphGet("/me/joinedTeams?$select=id,displayName", token) as Promise<{ value: Array<{ id: string; displayName?: string }> }>,
    ]);

    const chats = (chatsData.value ?? []).map(c => {
      let name = c.topic ?? null;
      if (!name && c.chatType === "oneOnOne" && c.members) {
        const other = c.members.find(m => m.userId !== myId);
        name = other?.displayName ?? c.members.map(m => m.displayName).filter(Boolean).join(", ") ?? "Chat";
      }
      if (!name) name = "Group Chat";
      return { id: c.id, name, chatType: c.chatType ?? "group", kind: "chat" as const };
    });

    const teams = teamsData.value ?? [];
    const channelResults = await Promise.allSettled(
      teams.map(async t => {
        const data = await graphGet(`/teams/${t.id}/channels?$select=id,displayName`, token) as { value: Array<{ id: string; displayName?: string }> };
        return (data.value ?? []).map(ch => ({
          id: ch.id,
          name: ch.displayName ?? "Channel",
          teamId: t.id,
          teamName: t.displayName ?? "Team",
          kind: "channel" as const,
        }));
      })
    );

    const channels = channelResults.flatMap(r => r.status === "fulfilled" ? r.value : []);

    res.json({ chats, channels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/brain/teams-connect", async (req: Request, res: Response): Promise<void> => {
  const { type = "chat", chatId, teamId, channelId } = req.body as {
    type?: "chat" | "channel";
    chatId?: string;
    teamId?: string;
    channelId?: string;
  };

  const resourceId = type === "channel" ? channelId : chatId;
  if (!resourceId) {
    res.status(400).json({ error: type === "channel" ? "teamId and channelId required" : "chatId required" });
    return;
  }
  if (type === "channel" && !teamId) {
    res.status(400).json({ error: "teamId required for channel connections" });
    return;
  }

  const token = await getValidToken();
  if (!token) {
    res.status(401).json({ error: "Microsoft account not connected" });
    return;
  }

  try {
    const prefs = await getPrefs();

    if (prefs?.brainTeamsSubId) {
      try { await graphDelete(`/subscriptions/${prefs.brainTeamsSubId}`, token); } catch { /* already gone */ }
    }

    const resource = type === "channel"
      ? `teams/${teamId}/channels/${resourceId}/messages`
      : `chats/${resourceId}/messages`;

    const sub = await createSubscription(resource, token);

    if (prefs) {
      await db.update(preferencesTable)
        .set({
          brainTeamsChatId: resourceId,
          brainTeamsTeamId: type === "channel" ? (teamId ?? "") : "",
          brainTeamsType: type,
          brainTeamsSubId: sub.id,
          brainTeamsSubExpiry: new Date(sub.expirationDateTime),
        })
        .where(eq(preferencesTable.id, prefs.id));
    }

    res.json({ success: true, subscriptionId: sub.id, expiresAt: sub.expirationDateTime });
  } catch (err) {
    console.error("[brain-teams] Connect failed:", err);
    const msg = String(err);
    if (msg.includes("403") || msg.includes("Forbidden")) {
      res.status(403).json({
        error: "Permission denied. For Teams channels, you need to re-authenticate with updated permissions. Go to the Integrations page and reconnect your Microsoft account.",
      });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

router.delete("/brain/teams-disconnect", async (_req: Request, res: Response): Promise<void> => {
  try {
    const prefs = await getPrefs();
    if (!prefs) { res.json({ success: true }); return; }

    if (prefs.brainTeamsSubId) {
      const token = await getValidToken();
      if (token) { try { await graphDelete(`/subscriptions/${prefs.brainTeamsSubId}`, token); } catch { /* already gone */ } }
    }

    await db.update(preferencesTable)
      .set({ brainTeamsChatId: "", brainTeamsSubId: "", brainTeamsSubExpiry: null, brainTeamsTeamId: "", brainTeamsType: "chat" })
      .where(eq(preferencesTable.id, prefs.id));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/brain/teams-webhook", async (req: Request, res: Response): Promise<void> => {
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(validationToken);
    return;
  }

  res.status(202).send();

  try {
    type Notification = {
      clientState?: string;
      changeType?: string;
      resource?: string;
      resourceData?: { id?: string; chatId?: string };
    };
    const notifications = ((req.body as { value?: Notification[] }).value) ?? [];

    for (const notification of notifications) {
      if (notification.clientState !== "brain-teams") continue;
      if (notification.changeType !== "created") continue;

      const messageId = notification.resourceData?.id;
      if (!messageId) continue;

      const resource = notification.resource ?? "";

      setImmediate(async () => {
        try {
          const token = await getValidToken();
          if (!token) return;

          const myUserId = await getMyUserId(token);
          const prefs = await getPrefs();
          const type = (prefs?.brainTeamsType as "chat" | "channel") ?? "chat";

          type ChatMessage = {
            from?: { user?: { id?: string; displayName?: string } };
            body?: { content?: string; contentType?: string };
            messageType?: string;
          };

          let message: ChatMessage;
          let chatId: string;
          let teamId: string | undefined;

          if (type === "channel") {
            const teamMatch = resource.match(/teams\('?([^'/)']+)'?\)/i);
            const channelMatch = resource.match(/channels\('?([^'/)']+)'?\)/i);
            teamId = teamMatch?.[1] ?? prefs?.brainTeamsTeamId ?? "";
            chatId = channelMatch?.[1] ?? prefs?.brainTeamsChatId ?? "";
            if (!teamId || !chatId) return;
            message = await graphGet(`/teams/${teamId}/channels/${chatId}/messages/${messageId}`, token) as ChatMessage;
          } else {
            const chatMatch = resource.match(/chats\('?([^'/)']+)'?\)/i);
            chatId = chatMatch?.[1] ?? notification.resourceData?.chatId ?? prefs?.brainTeamsChatId ?? "";
            if (!chatId) return;
            message = await graphGet(`/me/chats/${chatId}/messages/${messageId}`, token) as ChatMessage;
          }

          if (message.messageType && message.messageType !== "message") return;
          if (myUserId && message.from?.user?.id === myUserId) return;

          const rawContent = message.body?.content ?? "";
          const text = message.body?.contentType === "html" ? stripHtml(rawContent) : rawContent.trim();
          if (!text) return;

          console.log(`[brain-teams] ${type} message from ${message.from?.user?.displayName ?? "unknown"}: ${text.slice(0, 100)}`);

          await maybeRenew();
          const reply = await runBrainQuery(text);

          if (type === "channel") {
            await graphPost(`/teams/${teamId}/channels/${chatId}/messages`, { body: { content: reply, contentType: "text" } }, token);
          } else {
            await graphPost(`/me/chats/${chatId}/messages`, { body: { content: reply, contentType: "text" } }, token);
          }

          console.log("[brain-teams] Replied successfully");
        } catch (err) {
          console.error("[brain-teams] Processing error:", err);
        }
      });
    }
  } catch (err) {
    console.error("[brain-teams] Webhook parse error:", err);
  }
});

async function autoManageSubscription(): Promise<void> {
  try {
    const prefs = await getPrefs();
    if (!prefs?.brainTeamsChatId) return;

    const token = await getValidToken();
    if (!token) return;

    const expiry = prefs.brainTeamsSubExpiry ? new Date(prefs.brainTeamsSubExpiry) : null;
    const msUntilExpiry = expiry ? expiry.getTime() - Date.now() : -1;

    if (msUntilExpiry <= 0) {
      const type = (prefs.brainTeamsType as "chat" | "channel") ?? "chat";
      const resource = type === "channel"
        ? `teams/${prefs.brainTeamsTeamId}/channels/${prefs.brainTeamsChatId}/messages`
        : `chats/${prefs.brainTeamsChatId}/messages`;
      try {
        const sub = await createSubscription(resource, token);
        await db.update(preferencesTable)
          .set({ brainTeamsSubId: sub.id, brainTeamsSubExpiry: new Date(sub.expirationDateTime) })
          .where(eq(preferencesTable.id, prefs.id));
        console.log("[brain-teams] Subscription auto-recreated, expires:", sub.expirationDateTime);
      } catch (err) {
        console.error("[brain-teams] Failed to auto-recreate subscription:", err);
      }
    } else if (msUntilExpiry <= 15 * 60 * 1000) {
      await maybeRenew();
    }
  } catch (err) {
    console.error("[brain-teams] Auto-manage error:", err);
  }
}

setTimeout(autoManageSubscription, 5000);
setInterval(autoManageSubscription, 10 * 60 * 1000);

export default router;
