import { getValidToken, graphGet, graphPost } from "../routes/microsoft";

interface TeamEntry {
  id: string;
  displayName: string;
}

interface ChannelEntry {
  id: string;
  displayName: string;
}

interface AlertInfo {
  id: number;
  subject: string;
  alertType: string;
  priority: string;
  amazonAccountId: string;
  body?: string | null;
}

const teamsCache: TeamEntry[] = [];
let teamsCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const channelsCache = new Map<string, { channels: ChannelEntry[]; at: number }>();

async function getJoinedTeams(token: string): Promise<TeamEntry[]> {
  if (teamsCache.length > 0 && Date.now() - teamsCacheAt < CACHE_TTL_MS) {
    return teamsCache;
  }
  const data = await graphGet("/me/joinedTeams", token) as { value: TeamEntry[] };
  const teams = data.value ?? [];
  teamsCache.length = 0;
  teamsCache.push(...teams);
  teamsCacheAt = Date.now();
  return teams;
}

async function getChannels(teamId: string, token: string): Promise<ChannelEntry[]> {
  const cached = channelsCache.get(teamId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.channels;
  }
  const data = await graphGet(`/teams/${teamId}/channels`, token) as { value: ChannelEntry[] };
  const channels = data.value ?? [];
  channelsCache.set(teamId, { channels, at: Date.now() });
  return channels;
}

export async function resolveTeamAndChannelIds(
  teamName: string,
  channelName: string,
  msTeamId?: string | null,
  msChannelId?: string | null,
  token?: string,
): Promise<{ teamId: string; channelId: string } | null> {
  const accessToken = token ?? (await getValidToken());
  if (!accessToken) return null;

  let teamId = msTeamId ?? null;
  let channelId = msChannelId ?? null;

  if (!teamId) {
    const teams = await getJoinedTeams(accessToken);
    const match = teams.find(t => t.displayName.toLowerCase() === teamName.toLowerCase());
    if (!match) return null;
    teamId = match.id;
  }

  if (!channelId) {
    const channels = await getChannels(teamId, accessToken);
    const match = channels.find(c => c.displayName.toLowerCase() === channelName.toLowerCase());
    if (!match) return null;
    channelId = match.id;
  }

  return { teamId, channelId };
}

function buildAlertMessage(alert: AlertInfo, teamName: string, channelName: string): string {
  const priorityIcon = alert.priority === "critical" ? "🚨" :
    alert.priority === "high" ? "⚠️" :
    alert.priority === "medium" ? "ℹ️" : "📋";

  const summary = alert.body ? alert.body.slice(0, 300).replace(/\s+/g, " ").trim() : "(no body)";

  return [
    `${priorityIcon} Amazon Alert [${alert.priority.toUpperCase()}] — ${alert.alertType.replace(/_/g, " ")}`,
    `Alert ID: ${alert.id}`,
    `Subject: ${alert.subject}`,
    `Amazon Account: ${alert.amazonAccountId}`,
    `Routed to: ${teamName} / #${channelName}`,
    ``,
    `Summary: ${summary}`,
  ].join("\n");
}

export async function postAlertToTeamsChannel(
  alert: AlertInfo,
  teamName: string,
  channelName: string,
  msTeamId?: string | null,
  msChannelId?: string | null,
): Promise<void> {
  try {
    const token = await getValidToken();
    if (!token) {
      console.error(`[teamsNotifier] No valid Microsoft token — cannot post alert ${alert.id}`);
      return;
    }

    const ids = await resolveTeamAndChannelIds(teamName, channelName, msTeamId, msChannelId, token);
    if (!ids) {
      console.error(`[teamsNotifier] Could not resolve team/channel IDs for "${teamName}" / "${channelName}" — alert ${alert.id} not posted`);
      return;
    }

    const content = buildAlertMessage(alert, teamName, channelName);

    await graphPost(
      `/teams/${ids.teamId}/channels/${ids.channelId}/messages`,
      { body: { content, contentType: "text" } },
      token,
    );

    console.log(`[teamsNotifier] Posted alert ${alert.id} to ${teamName}/${channelName}`);
  } catch (err) {
    console.error(`[teamsNotifier] Failed to post alert ${alert.id} to Teams:`, err);
  }
}
