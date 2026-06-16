import { WebSocket } from "ws";
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { db, preferencesTable, meetingRequestsTable, bossMemoryTable } from "@workspace/db";
import { asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getValidToken, graphGet, graphPost } from "./microsoft";
import { ensureFreshPersona } from "../brain/persona";
import { loadNames, applyNames } from "../brain/engine";

const ZARA_CONFIG_ID = "79d22afd-439b-4e6a-991c-6125a979edd7";
function getSoulPath(): string {
  try {
    const url = import.meta.url;
    if (url) return resolve(dirname(fileURLToPath(url)), "../../data/soul.md");
  } catch {}
  return resolve(process.cwd(), "artifacts/api-server/data/soul.md");
}
const SOUL_PATH = getSoulPath();

async function loadSoul(): Promise<string> {
  try {
    return await readFile(SOUL_PATH, "utf-8");
  } catch {
    return "";
  }
}

function mulawDecode(ulaw: number): number {
  ulaw = (~ulaw) & 0xff;
  let t = ((ulaw & 0x0f) << 3) + 0x84;
  t <<= (ulaw & 0x70) >> 4;
  return (ulaw & 0x80) ? (0x84 - t) : (t - 0x84);
}

function mulawEncode(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > 32767) sample = 32767;
  sample += 0x84;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function mulawBufferToPcm16(mulaw: Buffer): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    out[i] = mulawDecode(mulaw[i]);
  }
  return out;
}

function pcm16ToMulawBuffer(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = mulawEncode(pcm[i]);
  }
  return out;
}

function resampleLinear(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = src - lo;
    out[i] = Math.round(input[lo] * (1 - frac) + input[hi] * frac);
  }
  return out;
}

function parseWav(buffer: Buffer): { sampleRate: number; channels: number; data: Int16Array } | null {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitDepth = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }

  if (dataStart < 0 || sampleRate === 0) return null;

  const raw = buffer.slice(dataStart, dataStart + dataSize);

  let pcm: Int16Array;
  if (bitDepth === 16) {
    pcm = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  } else if (bitDepth === 8) {
    pcm = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      pcm[i] = (raw[i] - 128) * 256;
    }
  } else {
    return null;
  }

  if (channels > 1) {
    const mono = new Int16Array(Math.floor(pcm.length / channels));
    for (let i = 0; i < mono.length; i++) {
      mono[i] = pcm[i * channels];
    }
    return { sampleRate, channels: 1, data: mono };
  }

  return { sampleRate, channels, data: pcm };
}

function humeAudioToMulaw(audioBuf: Buffer): Buffer | null {
  try {
    const wav = parseWav(audioBuf);
    if (wav) {
      const resampled = resampleLinear(wav.data, wav.sampleRate, 8000);
      return pcm16ToMulawBuffer(resampled);
    }

    if (audioBuf.length % 2 === 0) {
      const pcm = new Int16Array(audioBuf.buffer.slice(audioBuf.byteOffset, audioBuf.byteOffset + audioBuf.byteLength));
      const resampled = resampleLinear(pcm, 16000, 8000);
      return pcm16ToMulawBuffer(resampled);
    }
  } catch (e) {
    console.error("[hume-bridge] Audio conversion error:", e);
  }
  return null;
}

const BOSS_TOOL_DEFS: Record<string, unknown>[] = [
  {
    type: "function",
    name: "check_calendar",
    description: "Read upcoming calendar events from Microsoft 365. Call this when Sunny asks about his schedule.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days ahead to look (default 7)" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "check_emails",
    description: "Read recent emails from Sunny's Outlook inbox.",
    parameters: {
      type: "object",
      properties: {
        top: { type: "number", description: "Number of emails (default 5)" },
        unreadOnly: { type: "boolean", description: "Only unread emails" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "check_teams_chats",
    description: "Read Sunny's recent Microsoft Teams chats and messages.",
    parameters: {
      type: "object",
      properties: {
        top: { type: "number", description: "Number of chats (default 3)" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_pending_meetings",
    description: "List pending meeting requests that are waiting for Sunny's approval.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "approve_meeting",
    description: "Approve or reject a meeting request by ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Meeting request ID" },
        action: { type: "string", enum: ["approved", "rejected"], description: "What to do with the request" },
        response: { type: "string", description: "Optional message for the requester" },
      },
      required: ["id", "action"],
    },
  },
  {
    type: "function",
    name: "get_preferences",
    description: "Read Sunny's scheduling preferences: timezone, mood, max meetings per day, etc.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "update_mood",
    description: "Update Sunny's current mood/availability. Useful when Sunny says he's busy, tired, or available.",
    parameters: {
      type: "object",
      properties: {
        mood: { type: "string", enum: ["available", "busy", "do_not_disturb", "flexible"] },
        notes: { type: "string", description: "Optional notes" },
      },
      required: ["mood"],
    },
  },
  {
    type: "function",
    name: "recall_boss_memory",
    description: "Retrieve facts about Sunny from persistent memory. Call this any time you need to know something specific about Sunny — his preferences, travel plans, people he knows, rules he follows, or his current situation. Combine sections and tags for associative recall. If no filters given, returns everything.",
    parameters: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: { type: "string" },
          description: "Filter by section: identity, location, travel, schedule, communication, work, people, preferences, rules, health, current. Omit for all sections.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Cross-reference tags to find memories across sections (e.g. ['dubai'] retrieves all travel, location, and schedule info tagged 'dubai').",
        },
      },
      required: [],
    },
  },
];

const CUSTOMER_TOOL_DEFS: Record<string, unknown>[] = [
  {
    type: "function",
    name: "submit_meeting_request",
    description: "Submit a meeting request on behalf of the caller. Call this once you have collected: requester name, email (optional), purpose, preferred date/time, and urgency.",
    parameters: {
      type: "object",
      properties: {
        requesterName: { type: "string", description: "Full name of the person requesting the meeting" },
        requesterEmail: { type: "string", description: "Email address (use 'unknown@unknown.com' if not provided)" },
        requesterPhone: { type: "string", description: "Phone number of the caller if provided" },
        purpose: { type: "string", description: "What the meeting is about" },
        preferredDate: { type: "string", description: "Preferred date/time (ISO 8601 or natural language)" },
        urgency: { type: "string", enum: ["low", "medium", "high", "critical"], description: "How urgent is this?" },
      },
      required: ["requesterName", "purpose", "preferredDate", "urgency"],
    },
  },
];

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

async function executeAssistantTool(name: string, args: Record<string, unknown>, isBoss: boolean): Promise<string> {
  try {
    if (isBoss) {
      switch (name) {
        case "check_calendar": {
          const token = await getValidToken();
          if (!token) return "Microsoft 365 is not connected — I can't check the calendar right now.";
          const days = Math.min(typeof args.days === "number" ? args.days : 7, 30);
          const now = new Date();
          const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
          const params = new URLSearchParams({
            startDateTime: now.toISOString(),
            endDateTime: end.toISOString(),
            $top: "10",
            $orderby: "start/dateTime",
            $select: "subject,start,end,attendees,location",
          });
          const data = await graphGet(`/me/calendarView?${params.toString()}`, token) as { value: Array<Record<string, unknown>> };
          if (!data.value?.length) return `No events in the next ${days} days.`;
          return data.value.map((e: Record<string, unknown>) => {
            const startDt = (e.start as Record<string, string>)?.dateTime;
            const endDt = (e.end as Record<string, string>)?.dateTime;
            const loc = (e.location as Record<string, string>)?.displayName;
            return `${e.subject} — ${new Date(startDt).toLocaleString()} to ${new Date(endDt).toLocaleString()}${loc ? ` at ${loc}` : ""}`;
          }).join("\n");
        }
        case "check_emails": {
          const token = await getValidToken();
          if (!token) return "Microsoft 365 is not connected — can't check email.";
          const top = Math.min(typeof args.top === "number" ? args.top : 5, 15);
          const filter = args.unreadOnly === true ? "&$filter=isRead eq false" : "";
          const data = await graphGet(
            `/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,isRead,bodyPreview${filter}`,
            token
          ) as { value: Array<Record<string, unknown>> };
          if (!data.value?.length) return "Inbox is empty.";
          return data.value.map((m: Record<string, unknown>) => {
            const from = ((m.from as Record<string, unknown>)?.emailAddress as Record<string, string>);
            return `[${m.isRead ? "read" : "UNREAD"}] "${m.subject}" from ${from?.name ?? from?.address} — ${String(m.bodyPreview ?? "").slice(0, 80)}`;
          }).join("\n");
        }
        case "check_teams_chats": {
          const token = await getValidToken();
          if (!token) return "Microsoft 365 is not connected — can't check Teams.";
          const top = Math.min(typeof args.top === "number" ? args.top : 3, 10);
          const chatsData = await graphGet(`/me/chats?$top=${top}&$expand=members`, token) as { value: Array<Record<string, unknown>> };
          if (!chatsData.value?.length) return "No Teams chats found.";
          const summaries = await Promise.all(chatsData.value.map(async (chat: Record<string, unknown>) => {
            const members = Array.isArray(chat.members)
              ? (chat.members as Array<Record<string, string>>).map(m => m.displayName).filter(Boolean).join(", ")
              : "";
            try {
              const msgs = await graphGet(`/me/chats/${chat.id}/messages?$top=1`, token) as { value: Array<Record<string, unknown>> };
              const msg = msgs.value?.[0];
              if (msg) {
                const sender = ((msg.from as Record<string, unknown>)?.user as Record<string, string>)?.displayName ?? "someone";
                const body = (msg.body as Record<string, string>)?.content?.replace(/<[^>]+>/g, "").slice(0, 80) ?? "";
                return `${chat.topic || members}: ${sender}: "${body}"`;
              }
            } catch { /* ignore */ }
            return `${chat.topic || members}: (no messages)`;
          }));
          return summaries.join("\n");
        }
        case "get_pending_meetings": {
          const rows = await db.select().from(meetingRequestsTable)
            .where(eq(meetingRequestsTable.status, "pending"))
            .orderBy(desc(meetingRequestsTable.createdAt))
            .limit(5);
          if (!rows.length) return "No pending meeting requests.";
          return rows.map(r =>
            `[ID:${r.id}] ${r.requesterName} — "${r.purpose}" | ${r.urgency} urgency | Preferred: ${new Date(r.preferredDate).toDateString()}`
          ).join("\n");
        }
        case "approve_meeting": {
          const id = typeof args.id === "number" ? args.id : Number(args.id);
          const status = typeof args.action === "string" ? args.action : "approved";
          const response = typeof args.response === "string" ? args.response : undefined;
          const [updated] = await db.update(meetingRequestsTable)
            .set({ status, ...(response ? { bossResponse: response } : {}) })
            .where(eq(meetingRequestsTable.id, id))
            .returning();
          if (!updated) return `Meeting request ID ${id} not found.`;
          return `Meeting request ID ${id} has been ${status}.${response ? ` Response: "${response}"` : ""}`;
        }
        case "get_preferences": {
          let [prefs] = await db.select().from(preferencesTable).limit(1);
          if (!prefs) [prefs] = await db.insert(preferencesTable).values({}).returning();
          return `Mood: ${prefs.mood} | Timezone: ${prefs.timezone} | City: ${prefs.currentCity} | Max meetings/day: ${prefs.maxMeetingsPerDay} | Meeting duration: ${prefs.meetingDurationMinutes}min | Notes: ${prefs.notes || "none"}`;
        }
        case "update_mood": {
          let [existing] = await db.select().from(preferencesTable).limit(1);
          if (!existing) [existing] = await db.insert(preferencesTable).values({}).returning();
          const mood = typeof args.mood === "string" ? args.mood : "available";
          const notes = typeof args.notes === "string" ? args.notes : undefined;
          await db.update(preferencesTable)
            .set({ mood, ...(notes !== undefined ? { notes } : {}) })
            .where(eq(preferencesTable.id, existing.id));
          return `Got it — mood updated to "${mood}".${notes ? ` Notes: "${notes}"` : ""}`;
        }
        case "recall_boss_memory": {
          const sections = Array.isArray(args.sections) ? args.sections as string[] : [];
          const tags = Array.isArray(args.tags) ? args.tags as string[] : [];

          let query = db.select().from(bossMemoryTable).$dynamic();
          const conditions = [];
          if (sections.length > 0) conditions.push(inArray(bossMemoryTable.section, sections));
          if (tags.length > 0) conditions.push(sql`${bossMemoryTable.tags} ?| array[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]`);

          if (conditions.length > 0) {
            query = conditions.length === 2 ? query.where(or(...conditions)) : query.where(conditions[0]);
          }

          const memories = await query.orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key));
          if (memories.length === 0) return JSON.stringify({ result: "no_memories", message: "No memories found matching those filters." });

          const grouped: Record<string, Array<{key: string; value: string; tags: string[]; importance: number; source: string}>> = {};
          for (const m of memories) {
            if (!grouped[m.section]) grouped[m.section] = [];
            grouped[m.section].push({ key: m.key, value: m.value, tags: (m.tags as string[]) ?? [], importance: m.importance, source: m.source });
          }
          return JSON.stringify(grouped, null, 2);
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } else {
      switch (name) {
        case "submit_meeting_request": {
          const requesterName = typeof args.requesterName === "string" ? args.requesterName : "Unknown";
          const requesterEmail = typeof args.requesterEmail === "string" ? args.requesterEmail : "unknown@unknown.com";
          const requesterPhone = typeof args.requesterPhone === "string" ? args.requesterPhone : "";
          const purpose = typeof args.purpose === "string" ? args.purpose : "Meeting";
          const preferredDate = typeof args.preferredDate === "string" ? args.preferredDate : new Date().toISOString();
          const urgency = typeof args.urgency === "string" ? args.urgency : "medium";
          const [created] = await db.insert(meetingRequestsTable).values({
            requesterName,
            requesterEmail,
            requesterPhone,
            purpose,
            preferredDate: new Date(preferredDate),
            urgency,
            status: "pending",
          }).returning();
          return `Meeting request submitted successfully. ID: ${created.id}. ${requesterName}'s request for "${purpose}" has been logged and will be reviewed.`;
        }
        default:
          return `Tool not available in customer mode: ${name}`;
      }
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function handleTwilioHumeBridge(twilioWs: WebSocket, callerPhone = ""): void {
  let streamSid: string | null = null;
  let humeWs: WebSocket | null = null;
  let isBoss = false;

  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    console.error("[hume-bridge] HUME_API_KEY not set");
    twilioWs.close();
    return;
  }

  const params = new URLSearchParams({ api_key: apiKey, config_id: ZARA_CONFIG_ID });
  const humeUrl = `wss://api.hume.ai/v0/evi/chat?${params.toString()}`;

  console.log("[hume-bridge] Connecting to Hume EVI for phone call…");
  humeWs = new WebSocket(humeUrl);

  humeWs.on("open", async () => {
    console.log("[hume-bridge] Hume EVI connected");

    const [soul, bossPersonaText] = await Promise.all([
      loadSoul(),
      ensureFreshPersona().catch(() => ""),
    ]);

    const allMemories = await db.select().from(bossMemoryTable).orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key));
    let memoryBlock = "";
    if (allMemories.length > 0) {
      const grouped: Record<string, typeof allMemories> = {};
      for (const m of allMemories) {
        if (!grouped[m.section]) grouped[m.section] = [];
        grouped[m.section].push(m);
      }
      const sectionLines = Object.entries(grouped).map(([section, items]) => {
        const lines = items.map(m => {
          const imp = m.importance === 3 ? " ⚠️ CRITICAL" : m.importance === 2 ? " ★" : "";
          return `  • ${m.key}: ${m.value}${imp}`;
        });
        return `### ${section.charAt(0).toUpperCase() + section.slice(1)}\n${lines.join("\n")}`;
      });
      memoryBlock = `\n\n## What You Know About the Boss\n\n${sectionLines.join("\n\n")}\n\nThis is your persistent memory — use it to personalize every interaction. You can also call recall_boss_memory mid-conversation to look up specific details.`;
    }

    let [prefs] = await db.select().from(preferencesTable).limit(1);
    if (!prefs) [prefs] = await db.insert(preferencesTable).values({}).returning();

    const bossPhone = prefs.bossPhone ?? "";
    const callerNorm = normalizePhone(callerPhone);
    const bossNorm = normalizePhone(bossPhone);
    isBoss = !!(bossNorm && callerNorm && callerNorm.endsWith(bossNorm.slice(-9)));

    let enabledBossTools: string[];
    let enabledCustomerTools: string[];
    if (prefs.toolConfig) {
      try {
        const cfg = JSON.parse(prefs.toolConfig) as Record<string, {
          boss?: boolean | { enabled?: boolean };
          customer?: boolean | { enabled?: boolean };
        }>;
        const isEnabled = (v: boolean | { enabled?: boolean } | undefined) => {
          if (v === undefined || v === null) return false;
          if (typeof v === "boolean") return v;
          return v.enabled === true;
        };
        enabledBossTools = Object.entries(cfg).filter(([, v]) => isEnabled(v.boss)).map(([k]) => k);
        enabledCustomerTools = Object.entries(cfg).filter(([, v]) => isEnabled(v.customer)).map(([k]) => k);
      } catch {
        enabledBossTools = (prefs.bossTools ?? "calendar,email,teams,meeting_requests,preferences").split(",");
        enabledCustomerTools = (prefs.customerTools ?? "submit_meeting_request").split(",");
      }
    } else {
      enabledBossTools = (prefs.bossTools ?? "calendar,email,teams,meeting_requests,preferences").split(",");
      enabledCustomerTools = (prefs.customerTools ?? "submit_meeting_request").split(",");
    }

    const toolMap: Record<string, Record<string, unknown>> = {
      calendar: BOSS_TOOL_DEFS.find(t => t.name === "check_calendar")!,
      email: BOSS_TOOL_DEFS.find(t => t.name === "check_emails")!,
      teams: BOSS_TOOL_DEFS.find(t => t.name === "check_teams_chats")!,
      meeting_requests: BOSS_TOOL_DEFS.find(t => t.name === "get_pending_meetings")!,
      approve_meeting: BOSS_TOOL_DEFS.find(t => t.name === "approve_meeting")!,
      preferences: BOSS_TOOL_DEFS.find(t => t.name === "get_preferences")!,
      update_mood: BOSS_TOOL_DEFS.find(t => t.name === "update_mood")!,
      submit_meeting_request: CUSTOMER_TOOL_DEFS.find(t => t.name === "submit_meeting_request")!,
    };

    const recallMemoryTool = BOSS_TOOL_DEFS.find(t => t.name === "recall_boss_memory")!;

    let tools: Record<string, unknown>[];
    if (isBoss) {
      tools = [
        ...enabledBossTools.map(k => toolMap[k]).filter(Boolean),
        toolMap.approve_meeting,
        toolMap.update_mood,
        recallMemoryTool,
      ].filter((t, i, arr) => t && arr.findIndex(x => x?.name === t.name) === i);
    } else {
      tools = enabledCustomerTools.map(k => toolMap[k]).filter(Boolean);
    }

    const modeLabel = isBoss ? "BOSS" : "CUSTOMER";
    console.log(`[hume-bridge] Mode: ${modeLabel} | Caller: ${callerPhone} | Tools: ${tools.map(t => t.name).join(", ")}`);

    const { bossName, botName } = await loadNames();

    const bossToolNote = isBoss
      ? `\n\n## Live Tools Available\nYou now have real-time access to ${bossName}'s data:\n- check_calendar: check upcoming calendar events\n- check_emails: read inbox emails\n- check_teams_chats: read Teams messages\n- get_pending_meetings: see pending meeting requests\n- approve_meeting: approve or reject a meeting by ID\n- get_preferences: read ${bossName}'s preferences\n- update_mood: update ${bossName}'s mood/availability\n- recall_boss_memory: look up any fact about ${bossName} from persistent memory\n\nUse these tools freely when ${bossName} asks about his schedule, emails, meetings, or wants to change his status. Use recall_boss_memory whenever you need specific context about ${bossName} that isn't in the memory block above.`
      : "\n\n## Live Tools Available\nYou have access to:\n- submit_meeting_request: submit a meeting request once you have all the details (name, purpose, preferred time, urgency). Call this automatically after collecting the info — do not tell the customer you are submitting it, just do it and confirm it's been noted.";

    const sessionSettings: Record<string, unknown> = {
      type: "session_settings",
      audio: {
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
      },
      tools,
    };

    const dynamicTools = JSON.parse(applyNames(JSON.stringify(tools), bossName, botName));
    sessionSettings.tools = dynamicTools;

    const basePrompt = soul || "";
    if (isBoss) {
      sessionSettings.system_prompt = applyNames(basePrompt + memoryBlock + bossToolNote, bossName, botName);
    } else {
      const personaBlock = bossPersonaText
        ? `\n\n## Boss Intelligence Briefing\n\nThis is a curated snapshot of the boss's scheduling preferences and current status. Use it to represent him accurately in every scheduling conversation:\n\n${bossPersonaText}`
        : "";
      sessionSettings.system_prompt = applyNames(basePrompt + personaBlock + bossToolNote, bossName, botName);
    }

    humeWs!.send(JSON.stringify(sessionSettings));
  });

  humeWs.on("message", (raw: Buffer) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = msg.type as string | undefined;

    if (type === "audio_output") {
      const audioBuf = Buffer.from(msg.data as string, "base64");
      const mulaw = humeAudioToMulaw(audioBuf);
      if (mulaw && streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: mulaw.toString("base64") },
        }));
      }
    } else if (type === "user_interruption") {
      if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
      }
    } else if (type === "tool_call") {
      const toolCallId = msg.tool_call_id as string;
      const toolName = msg.name as string;
      const rawParams = msg.parameters as string ?? "{}";
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(rawParams) as Record<string, unknown>; } catch { /* ignore */ }
      console.log(`[hume-bridge] Tool call: ${toolName}`, toolArgs);
      void executeAssistantTool(toolName, toolArgs, isBoss).then(result => {
        console.log(`[hume-bridge] Tool result for ${toolName}:`, result.slice(0, 120));
        if (humeWs && humeWs.readyState === WebSocket.OPEN) {
          humeWs.send(JSON.stringify({
            type: "tool_response",
            tool_call_id: toolCallId,
            content: result,
          }));
        }
      });
    } else if (type === "error") {
      console.error("[hume-bridge] Hume error:", msg);
    }
  });

  humeWs.on("close", (code: number) => {
    console.log("[hume-bridge] Hume WS closed, code:", code);
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  });

  humeWs.on("error", (err: Error) => {
    console.error("[hume-bridge] Hume WS error:", err.message);
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  });

  twilioWs.on("message", (raw: Buffer) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.event === "start") {
      const startData = msg.start as { streamSid?: string } | undefined;
      streamSid = startData?.streamSid ?? null;
      console.log("[hume-bridge] Twilio stream started, streamSid:", streamSid);
    } else if (msg.event === "media") {
      if (!humeWs || humeWs.readyState !== WebSocket.OPEN) return;

      const media = msg.media as { payload?: string } | undefined;
      if (!media?.payload) return;

      const mulaw = Buffer.from(media.payload, "base64");
      const pcm8k = mulawBufferToPcm16(mulaw);
      const pcm16k = resampleLinear(pcm8k, 8000, 16000);

      const pcmBuf = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);

      humeWs.send(JSON.stringify({
        type: "audio_input",
        data: pcmBuf.toString("base64"),
      }));
    } else if (msg.event === "stop") {
      console.log("[hume-bridge] Twilio stream stopped");
      humeWs?.close();
    }
  });

  twilioWs.on("close", () => {
    console.log("[hume-bridge] Twilio WS closed");
    humeWs?.close();
  });

  twilioWs.on("error", (err: Error) => {
    console.error("[hume-bridge] Twilio WS error:", err.message);
    humeWs?.close();
  });
}
