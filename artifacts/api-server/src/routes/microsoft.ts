import { Router, type IRouter, type Request, type Response } from "express";
import { db, microsoftTokens } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { createSession, getSessionId, deleteSession, SESSION_COOKIE, SESSION_TTL } from "../lib/auth";

const router: IRouter = Router();

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET ?? "";
const TENANT_ID = process.env.MICROSOFT_TENANT_ID ?? "";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "Chat.ReadWrite",
  "ChannelMessage.Send",
  "ChannelMessage.Read.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
].join(" ");

function getRedirectUri(): string {
  // Explicit override always wins
  if (process.env.MICROSOFT_REDIRECT_URI) {
    return process.env.MICROSOFT_REDIRECT_URI;
  }
  // In a Replit deployment REPLIT_DEPLOYMENT is set — always use the registered custom domain
  if (process.env.REPLIT_DEPLOYMENT) {
    return "https://mateos.example.com/api/microsoft/callback";
  }
  // Dev: use the Replit tunnel domain (registered in Azure for dev sessions)
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}/api/microsoft/callback`;
  }
  return "https://mateos.example.com/api/microsoft/callback";
}

function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    response_mode: "query",
  });
  if (state) params.set("state", state);
  return `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

router.get("/microsoft/login", (req: Request, res: Response): void => {
  const returnTo = typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
    ? req.query.returnTo
    : "/";
  const state = Buffer.from(JSON.stringify({ source: "login", returnTo })).toString("base64url");
  res.redirect(getAuthUrl(state));
});

router.get("/microsoft/logout", async (req: Request, res: Response): Promise<void> => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }
  res.redirect("/");
});

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string } | null> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: SCOPES,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  } catch {
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const [token] = await db.select().from(microsoftTokens).orderBy(desc(microsoftTokens.createdAt)).limit(1);
  if (!token) return null;

  if (token.expiresAt > new Date(Date.now() + 60000)) {
    return token.accessToken;
  }

  if (token.refreshToken) {
    const refreshed = await refreshAccessToken(token.refreshToken);
    if (refreshed) {
      await db.update(microsoftTokens)
        .set({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt, updatedAt: new Date() })
        .where(eq(microsoftTokens.id, token.id));
      return refreshed.accessToken;
    }
  }
  return null;
}

async function graphGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function graphPost(path: string, body: unknown, accessToken: string): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

router.get("/microsoft/status", async (_req: Request, res: Response): Promise<void> => {
  const [token] = await db.select().from(microsoftTokens).orderBy(desc(microsoftTokens.createdAt)).limit(1);
  if (!token) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    userEmail: token.userEmail,
    displayName: token.displayName,
    scope: token.scope,
    expiresAt: token.expiresAt,
    tokenId: token.id,
  });
});

router.get("/microsoft/auth-url", (_req: Request, res: Response): void => {
  if (!CLIENT_ID || !TENANT_ID) {
    res.status(500).json({ error: "Microsoft credentials not configured" });
    return;
  }
  res.json({ url: getAuthUrl() });
});

router.get("/microsoft/callback", async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;
  const rawState = req.query.state as string | undefined;

  let stateData: { source?: string; returnTo?: string } = {};
  if (rawState) {
    try { stateData = JSON.parse(Buffer.from(rawState, "base64url").toString()) as typeof stateData; } catch { /* ignore */ }
  }
  const isLoginFlow = stateData.source === "login";
  const returnTo = stateData.returnTo ?? "/";

  if (error || !code) {
    if (isLoginFlow) {
      res.redirect(`/login?error=${error ?? "no_code"}`);
    } else {
      res.send(`<html><body><script>window.opener?.postMessage({type:"ms-auth-error",error:"${error ?? "no_code"}"}, "*"); window.close();</script></body></html>`);
    }
    return;
  }

  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
        scope: SCOPES,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[Microsoft OAuth] token exchange failed:", err);
      if (isLoginFlow) {
        res.redirect("/login?error=token_exchange_failed");
      } else {
        res.send(`<html><body><script>window.opener?.postMessage({type:"ms-auth-error",error:"token_exchange_failed"}, "*"); window.close();</script></body></html>`);
      }
      return;
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json() as { mail?: string; userPrincipalName?: string; id?: string; displayName?: string; givenName?: string; surname?: string };

    await db.delete(microsoftTokens).where(eq(microsoftTokens.id, 0));

    const [existing] = await db.select().from(microsoftTokens).limit(1);
    if (existing) {
      await db.update(microsoftTokens).set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scope: tokenData.scope,
        userEmail: user.mail ?? user.userPrincipalName ?? null,
        userId: user.id ?? null,
        displayName: user.displayName ?? null,
        updatedAt: new Date(),
      }).where(eq(microsoftTokens.id, existing.id));
    } else {
      await db.insert(microsoftTokens).values({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scope: tokenData.scope,
        userEmail: user.mail ?? user.userPrincipalName ?? null,
        userId: user.id ?? null,
        displayName: user.displayName ?? null,
      });
    }

    if (isLoginFlow) {
      const email = user.mail ?? user.userPrincipalName ?? "";
      const nameParts = (user.displayName ?? "").split(" ");
      const sid = await createSession({
        user: {
          id: user.id ?? email,
          email,
          firstName: user.givenName ?? nameParts[0] ?? null,
          lastName: user.surname ?? (nameParts.slice(1).join(" ") || null),
          profileImageUrl: null,
        },
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + tokenData.expires_in * 1000,
      });
      res.cookie(SESSION_COOKIE, sid, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL,
      });
      console.log(`[Microsoft Auth] Login session created for ${email}`);
      res.redirect(returnTo);
      return;
    }

    res.send(`<html><body><script>window.opener?.postMessage({type:"ms-auth-success",email:"${user.mail ?? user.userPrincipalName ?? ""}"}, "*"); window.close();</script></body></html>`);
  } catch (err) {
    console.error("[Microsoft OAuth] callback error:", err);
    res.send(`<html><body><script>window.opener?.postMessage({type:"ms-auth-error",error:"server_error"}, "*"); window.close();</script></body></html>`);
  }
});

router.post("/microsoft/disconnect", async (_req: Request, res: Response): Promise<void> => {
  await db.delete(microsoftTokens);
  res.json({ success: true });
});

router.get("/microsoft/profile", async (_req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const data = await graphGet("/me", token);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const days = parseInt((req.query.days as string) ?? "7");
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
      $orderby: "start/dateTime",
      $top: "20",
      $select: "id,subject,start,end,location,organizer,attendees,bodyPreview,isAllDay,showAs",
    });
    const data = await graphGet(`/me/calendarView?${params.toString()}`, token) as { value: unknown[] };
    res.json({ events: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/microsoft/calendar/event", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  const { subject, start, end, attendees, body: bodyContent, location } = req.body as {
    subject: string; start: string; end: string; attendees?: string[]; body?: string; location?: string;
  };
  if (!subject || !start || !end) { res.status(400).json({ error: "subject, start, end required" }); return; }
  try {
    const event = {
      subject,
      start: { dateTime: start, timeZone: "UTC" },
      end: { dateTime: end, timeZone: "UTC" },
      ...(bodyContent ? { body: { contentType: "text", content: bodyContent } } : {}),
      ...(location ? { location: { displayName: location } } : {}),
      ...(attendees?.length ? {
        attendees: attendees.map((email: string) => ({
          emailAddress: { address: email },
          type: "required",
        })),
      } : {}),
    };
    const data = await graphPost("/me/events", event, token);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/mail/inbox", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const top = parseInt((req.query.top as string) ?? "20");
    const filter = req.query.filter as string | undefined;
    const params = new URLSearchParams({
      $top: String(top),
      $orderby: "receivedDateTime desc",
      $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,importance,hasAttachments",
    });
    if (filter) params.set("$filter", filter);
    const data = await graphGet(`/me/mailFolders/inbox/messages?${params.toString()}`, token) as { value: unknown[] };
    res.json({ messages: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/microsoft/mail/send", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  const { to, subject, body: bodyContent } = req.body as { to: string; subject: string; body: string };
  if (!to || !subject || !bodyContent) { res.status(400).json({ error: "to, subject, body required" }); return; }
  try {
    await graphPost("/me/sendMail", {
      message: {
        subject,
        body: { contentType: "text", content: bodyContent },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }, token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/teams/list", async (_req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const data = await graphGet("/me/joinedTeams", token) as { value: unknown[] };
    res.json({ teams: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/chats", async (_req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const data = await graphGet(
      "/me/chats?$expand=members&$top=30",
      token,
    ) as { value: unknown[] };
    res.json({ chats: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/chats/:chatId/messages", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const data = await graphGet(
      `/me/chats/${req.params.chatId}/messages?$top=30`,
      token,
    ) as { value: unknown[] };
    res.json({ messages: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/microsoft/chats/:chatId/message", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  const { content } = req.body as { content: string };
  if (!content) { res.status(400).json({ error: "content required" }); return; }
  try {
    const data = await graphPost(
      `/me/chats/${req.params.chatId}/messages`,
      { body: { content, contentType: "text" } },
      token,
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/microsoft/teams/:teamId/channels", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  try {
    const data = await graphGet(`/teams/${req.params.teamId}/channels`, token) as { value: unknown[] };
    res.json({ channels: data.value ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/microsoft/teams/:teamId/channels/:channelId/message", async (req: Request, res: Response): Promise<void> => {
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "Not connected" }); return; }
  const { content } = req.body as { content: string };
  if (!content) { res.status(400).json({ error: "content required" }); return; }
  try {
    const data = await graphPost(
      `/teams/${req.params.teamId}/channels/${req.params.channelId}/messages`,
      { body: { content } },
      token,
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
export { getValidToken, graphGet, graphPost };

export async function graphPatch(path: string, body: unknown, accessToken: string): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

export async function graphDelete(path: string, accessToken: string): Promise<void> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
}
