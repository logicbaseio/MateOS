import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { asc, and, desc, eq, sql, inArray, or, ilike } from "drizzle-orm";
import {
  db,
  brainMessages,
  meetingRequestsTable,
  preferencesTable,
  amazonAlertsTable,
  teamChannelsTable,
  conversations,
  bossNotifications,
  channelSessions,
  bossMemoryTable,
  customersTable,
  customerInteractionsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getLLMClient } from "../lib/llm";
import { deliverMessageToBoss } from "../lib/messenger";
import { getValidToken, graphGet, graphPost } from "../routes/microsoft";
import { postAlertToTeamsChannel } from "../lib/teamsNotifier";
import { generateBossPersona, schedulePersonaRefresh } from "./persona";
import { callBossOutbound } from "../routes/voice";
import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

type FunctionTool = Extract<ChatCompletionTool, { type: "function" }>;
type FunctionToolCall = Extract<ChatCompletionMessageToolCall, { type: "function" }>;

function isFunctionTool(tool: ChatCompletionTool): tool is FunctionTool {
  return tool.type === "function";
}

function isFunctionToolCall(toolCall: ChatCompletionMessageToolCall): toolCall is FunctionToolCall {
  return toolCall.type === "function";
}

function getSoulPath(): string {
  try {
    const url = import.meta.url;
    if (url) return resolve(dirname(fileURLToPath(url)), "../../data/soul.md");
  } catch {}
  return resolve(process.cwd(), "artifacts/api-server/data/soul.md");
}
export const SOUL_PATH = getSoulPath();

export async function loadNames(): Promise<{ bossName: string; botName: string }> {
  try {
    const [row] = await db.select({ bossName: preferencesTable.bossName, botName: preferencesTable.botName }).from(preferencesTable).limit(1);
    return {
      bossName: row?.bossName?.trim() || "Owner",
      botName: row?.botName?.trim() || "Mate",
    };
  } catch {
    return { bossName: "Owner", botName: "Mate" };
  }
}

const BOSS_NOTIFICATION_TOOL_NAMES = new Set(["notify_boss", "notify_sunny"]);

// Known historical bot names that may appear in old session history or soul files.
// Any of these will be replaced with the current live botName.
const LEGACY_BOT_NAMES = ["Zara", "MIRA", "Maddie"];

export function applyNames(text: string, bossName: string, botName: string): string {
  let result = text
    .replaceAll("{{bossName}}", bossName)
    .replaceAll("{{botName}}", botName)
    .replaceAll("Sunny", bossName);
  for (const legacy of LEGACY_BOT_NAMES) {
    if (legacy !== botName) {
      result = result.replaceAll(legacy, botName);
    }
  }
  return result;
}

function applyNamesToTools(tools: ChatCompletionTool[], bossName: string, botName: string): ChatCompletionTool[] {
  const json = JSON.stringify(tools);
  return JSON.parse(applyNames(json, bossName, botName)) as ChatCompletionTool[];
}

export async function loadSoul(): Promise<string> {
  try {
    const rows = await db.select({ soulContent: preferencesTable.soulContent }).from(preferencesTable).limit(1);
    const dbContent = rows[0]?.soulContent;
    if (dbContent && dbContent.trim().length > 0) return dbContent;
  } catch {}
  try {
    return await readFile(SOUL_PATH, "utf-8");
  } catch {
    return "";
  }
}

async function saveSoul(content: string): Promise<void> {
  try {
    const rows = await db.select({ id: preferencesTable.id }).from(preferencesTable).limit(1);
    if (rows.length > 0) {
      await db.update(preferencesTable).set({ soulContent: content }).where(eq(preferencesTable.id, rows[0].id));
    } else {
      await db.insert(preferencesTable).values({ soulContent: content });
    }
  } catch (err) {
    console.warn("[soul] DB save failed:", (err as Error).message);
  }
  try {
    await writeFile(SOUL_PATH, content, "utf-8");
  } catch {
    // read-only fs in production — DB is the source of truth
  }
}

export const BRAIN_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_meeting_requests",
      description: "List meeting requests. Optionally filter by status (pending, approved, rejected, scheduled).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "approved", "rejected", "scheduled"],
            description: "Filter by status. Omit to list all.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_meeting_request",
      description: "Approve, reject, or update a meeting request. Use to take action on a specific request by ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Meeting request ID" },
          status: { type: "string", enum: ["pending", "approved", "rejected", "scheduled"] },
          bossResponse: { type: "string", description: "A message from Sunny to the requester, or internal notes" },
          scheduledTime: { type: "string", description: "ISO 8601 datetime if scheduling" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_meeting_request",
      description: "Create a meeting request in MateOS. Use when a customer or caller wants time with the boss and you have their name, purpose, and preferred date/time.",
      parameters: {
        type: "object",
        properties: {
          requester_name: { type: "string", description: "Full name of the person requesting the meeting." },
          requester_email: { type: "string", description: "Email address of the requester." },
          purpose: { type: "string", description: "What the meeting is about." },
          preferred_date: { type: "string", description: "ISO 8601 datetime string for the requested slot." },
          urgency: { type: "string", enum: ["low", "medium", "high"] },
          notes: { type: "string", description: "Any extra context or flexibility notes." },
        },
        required: ["requester_name", "purpose", "preferred_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_customer",
      description: "Look up a customer record by name, email, or phone. Returns their tier (New/Regular/VIP/Premium), lifetime revenue, meeting count, and notes. Call this at the start of every scheduling conversation to get customer context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, email address, or phone number to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_preferences",
      description: "Read the boss's current scheduling preferences (timezone, mood, max meetings, etc.)",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_preferences",
      description: "Update ANY of the boss's system preferences — scheduling, voice notes, ElevenLabs TTS, Telegram Brain channel, or the assistant's tool permissions. Always call get_preferences first so you only update what changed. Covers ALL configurable settings in MateOS.",
      parameters: {
        type: "object",
        properties: {
          bossName: { type: "string", description: "Boss's name (shown on dashboard and used in AI context)." },
          botName: { type: "string", description: "AI assistant name (the bot's name customers see and hear)." },
          timezone: { type: "string", description: "IANA timezone string (e.g. 'America/New_York'). Derive from city/region if the user mentions a location." },
          currentCity: { type: "string", description: "Boss's current city" },
          mood: { type: "string", enum: ["available", "busy", "do_not_disturb", "flexible"], description: "Current availability mood" },
          preferredMeetingTime: { type: "string", enum: ["morning", "afternoon", "evening", "night"], description: "General preferred meeting slot (coarse)" },
          workdayStart: { type: "string", description: "Start of the appointment window in HH:MM 24-hour format in the boss's timezone (e.g. '02:00' for 2 AM). Derive from natural language like '2AM'." },
          workdayEnd: { type: "string", description: "End of the appointment window in HH:MM 24-hour format in the boss's timezone (e.g. '06:00' for 6 AM). Derive from natural language like '6AM'." },
          maxMeetingsPerDay: { type: "number", description: "Maximum number of meetings per day" },
          meetingDurationMinutes: { type: "number", description: "Default meeting duration in minutes" },
          breakBetweenMeetings: { type: "number", description: "Minimum break between meetings in minutes" },
          notes: { type: "string", description: "Free-form scheduling notes or special instructions" },
          bossPhone: { type: "string", description: "The boss's phone number in E.164 format (e.g. +12125551234). The assistant uses this to detect boss vs customer calls." },
          bossTools: { type: "string", description: "Comma-separated list of tools the assistant can use in Boss mode. Options: calendar,email,teams,meeting_requests,preferences" },
          customerTools: { type: "string", description: "Comma-separated list of tools the assistant can use in Customer mode. Options: submit_meeting_request" },
          voiceNoteVoiceId: { type: "string", description: "ElevenLabs voice ID for the assistant's voice notes. Leave empty to use the agent's default." },
          voiceNoteInstructions: { type: "string", description: "Speaking style instructions for the assistant's TTS voice (e.g. 'speak slowly and warmly')." },
          voiceNoteStability: { type: "number", description: "ElevenLabs stability (0.0–1.0). Higher = more consistent, lower = more expressive." },
          voiceNoteSimilarityBoost: { type: "number", description: "ElevenLabs similarity boost (0.0–1.0). Higher = closer to the original voice." },
          voiceNoteStyle: { type: "number", description: "ElevenLabs style exaggeration (0.0–1.0). Higher = more stylistic." },
          voiceNoteSpeakerBoost: { type: "boolean", description: "ElevenLabs speaker boost — enhances speaker clarity. Set true or false." },
          elevenLabsApiKey: { type: "string", description: "ElevenLabs API key for TTS. Set to enable premium voice notes." },
          elevenLabsAgentId: { type: "string", description: "ElevenLabs conversational agent ID." },
          elevenLabsPhoneNumberId: { type: "string", description: "ElevenLabs phone number ID for outbound calling." },
          brainTelegramToken: { type: "string", description: "Telegram bot token for Brain's Telegram channel." },
          brainTelegramChatId: { type: "string", description: "Telegram chat ID that Brain listens to for boss commands." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_amazon_alerts",
      description: "List Amazon seller alerts. Optionally filter by status or priority.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["new", "routed", "resolved"] },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_amazon_alert",
      description: "Update an Amazon alert — route it to a team/channel, resolve it, or change its status.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          status: { type: "string", enum: ["new", "routed", "resolved"] },
          routedToTeam: { type: "string" },
          routedToChannel: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_team_channels",
      description: "List all configured Microsoft Teams channels for Amazon alert routing.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_soul",
      description: "Read the current contents of soul.md — the assistant's personality, rules, and memory.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_soul",
      description: "Rewrite soul.md with new personality instructions, rules, or memory for the assistant.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The full new content of soul.md in markdown" },
          summary: { type: "string", description: "Brief description of what you changed and why" },
        },
        required: ["content", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_stats",
      description: "Get a summary overview of the MateOS system: pending meetings, active alerts, total conversations, team channels.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_conversations",
      description: "List active Zara relay conversations (customer ↔ Zara ↔ Sunny chat sessions).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_get_calendar",
      description: "Read Sunny's Microsoft 365 calendar. Returns upcoming events for the next N days.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days ahead to look (default 7, max 30)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_get_emails",
      description: "Read Sunny's Outlook inbox. Returns recent emails.",
      parameters: {
        type: "object",
        properties: {
          top: { type: "number", description: "Number of emails to fetch (default 10, max 25)" },
          unreadOnly: { type: "boolean", description: "Only return unread emails (default false)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_get_teams_chats",
      description: "Read Sunny's Microsoft Teams chats — list recent chats and their latest messages.",
      parameters: {
        type: "object",
        properties: {
          top: { type: "number", description: "Number of chats to fetch (default 5)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_send_teams_message",
      description: "Send a message to a Microsoft Teams chat on Sunny's behalf.",
      parameters: {
        type: "object",
        properties: {
          chatId: { type: "string", description: "The Teams chat ID to send to" },
          message: { type: "string", description: "The message text to send" },
        },
        required: ["chatId", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_send_email",
      description: "Send an email from Sunny's Outlook account.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (plain text or HTML)" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ms_create_calendar_event",
      description: "Create a calendar event in Sunny's Microsoft 365 calendar. CRITICAL TIMEZONE RULE: the start/end must be the LOCAL time in Sunny's timezone — NOT UTC. Example: if the agreed time is 9:00 PM MYT (Asia/Kuala_Lumpur), pass start='2026-04-15T21:00:00' and timeZone='Asia/Kuala_Lumpur'. Never pass UTC time or compute a UTC offset yourself — use the result from convert_timezone directly.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Event title" },
          start: { type: "string", description: "ISO 8601 LOCAL datetime in Sunny's timezone — no Z, no UTC offset. Use the time convert_timezone returned for Sunny's timezone. E.g. if convert_timezone says '21:00 MYT', pass '2026-04-15T21:00:00'." },
          end: { type: "string", description: "ISO 8601 LOCAL datetime in Sunny's timezone — no Z, no UTC offset. Add the meeting duration to the start time." },
          timeZone: { type: "string", description: "IANA timezone string from Sunny's preferences (e.g. 'Asia/Kuala_Lumpur'). Required — always pass this." },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses",
          },
          body: { type: "string", description: "Optional event description" },
          location: { type: "string", description: "Optional location" },
        },
        required: ["subject", "start", "end", "timeZone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_boss_memory",
      description: "Retrieve memories about Sunny from the structured memory store. Combine sections and tags for associative recall — e.g. sections=['travel','location'] tags=['dubai'] returns all travel preferences AND Dubai-specific knowledge simultaneously. If no filters given, returns all memories. Call this before making scheduling decisions, timezone changes, or any action that depends on knowing Sunny's context.",
      parameters: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: { type: "string" },
            description: "Filter by section names. Valid sections: identity, location, travel, schedule, communication, work, people, preferences, rules, health, current. Omit for all sections.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Cross-reference tags to retrieve memories from ANY section that has these tags. E.g. ['dubai'] pulls location + travel + people memories all tagged 'dubai'.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_boss_memory",
      description: "Save or update one or more memory items about Sunny. Use this immediately whenever you learn something new — location, preference, travel plan, relationship, rule, or any personal fact. Always batch multiple related facts in one call. Use meaningful keys (e.g. 'current_city', 'dubai_preference_calls', 'relationship_with_john'). Upserts by (section, key).",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "Array of memory items to save. Each item upserts by (section+key).",
            items: {
              type: "object",
              properties: {
                section: { type: "string", description: "Memory section: identity | location | travel | schedule | communication | work | people | preferences | rules | health | current" },
                key: { type: "string", description: "Short unique identifier within this section (snake_case, e.g. 'current_city', 'prefers_fewer_calls_when_traveling')" },
                value: { type: "string", description: "The memory content — write it as a clear, complete statement (e.g. 'Sunny is currently in Dubai for a fintech conference. Arrived March 25, returning April 5.')" },
                tags: { type: "array", items: { type: "string" }, description: "Cross-reference tags for associative recall (e.g. ['dubai', 'travel', 'schedule']). Use city names, topic names, people names, etc." },
                importance: { type: "number", description: "1 = nice-to-know, 2 = important, 3 = critical rule the bot must always follow" },
                source: { type: "string", enum: ["stated", "inferred"], description: "'stated' if Sunny said it directly; 'inferred' if you deduced it" },
              },
              required: ["section", "key", "value"],
            },
          },
        },
        required: ["entries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_boss_memory",
      description: "Delete a specific memory item when it is outdated or Sunny says it is no longer true. Use the exact section and key from recall_boss_memory.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", description: "The section the memory is in" },
          key: { type: "string", description: "The exact key of the memory to delete" },
        },
        required: ["section", "key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_boss_persona",
      description: "Regenerate the Boss Persona that Zara reads for all customer conversations. Compiles everything in boss memory — identity, work, professional background, relationships, location, scheduling rules — into a comprehensive briefing. Call this after any significant memory update, or whenever Sunny explicitly asks you to update what Zara knows about him.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_timezone",
      description: "Accurately convert a time from one IANA timezone to another using the server clock — guaranteed correct. ALWAYS call this before checking Sunny's availability window when a customer gives a time in their own timezone. NEVER do timezone math from memory — GPT timezone offsets are unreliable and cause double-booking disasters.",
      parameters: {
        type: "object",
        properties: {
          time:          { type: "string", description: "Time to convert in HH:MM 24-hour format, e.g. '21:00'" },
          date:          { type: "string", description: "Date in YYYY-MM-DD format (required for DST accuracy). Use today's date if the customer didn't specify." },
          from_timezone: { type: "string", description: "IANA timezone of the input time. Common values: 'Asia/Karachi' (PKT), 'Asia/Kuala_Lumpur' (MYT), 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Kolkata', 'America/Los_Angeles'" },
          to_timezone:   { type: "string", description: "IANA timezone to convert to, e.g. 'Asia/Kuala_Lumpur'" },
        },
        required: ["time", "date", "from_timezone", "to_timezone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_boss",
      description: "Place an outbound phone call to Sunny's stored phone number (bossPhone) so Zara can relay a customer situation and get real-time instructions. Use this ONLY when ALL of the following are true: (1) a customer conversation is genuinely stuck and cannot proceed without Sunny's personal input, (2) Sunny has not replied to a prior text or notification ping after a reasonable wait (typically 3–5 minutes), AND (3) the situation is urgent enough to justify interrupting Sunny directly. Do NOT use for routine meeting requests or anything Zara can handle autonomously. When you call this tool, tell the customer that Zara is checking in with Sunny directly and they should hold.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief explanation of why the outbound call is being placed — what the customer needs and why it cannot wait.",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_customers",
      description: "List all customers in MateOS. Optionally filter by tier (new, regular, vip, premium) or status (active, inactive). Returns name, email, phone, company, tier, total revenue, and notes.",
      parameters: {
        type: "object",
        properties: {
          tier: { type: "string", enum: ["new", "regular", "vip", "premium"], description: "Filter by tier." },
          status: { type: "string", enum: ["active", "inactive"], description: "Filter by status." },
          limit: { type: "number", description: "Max records to return (default 20)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_customer",
      description: "Update a customer record — change their tier, status, notes, revenue, or company. Use lookup_customer first to get their ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Customer ID (from lookup_customer or list_customers)" },
          tier: { type: "string", enum: ["new", "regular", "vip", "premium"], description: "New tier" },
          status: { type: "string", enum: ["active", "inactive"], description: "New status" },
          notes: { type: "string", description: "Updated notes about this customer" },
          company: { type: "string", description: "Company name" },
          totalRevenue: { type: "string", description: "Total lifetime revenue as a decimal string (e.g. '5000.00')" },
          currency: { type: "string", description: "3-letter currency code (e.g. 'USD', 'GBP', 'MYR')" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notifications",
      description: "List pending or recent notifications sent to Sunny — these are alerts where a customer is waiting for Sunny's response. Shows who is waiting, on which channel, and why.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "replied", "ignored"], description: "Filter by status. Omit for all." },
          limit: { type: "number", description: "Max records to return (default 10)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_brain_conversation",
      description: "Clear Brain's conversation history so you start fresh. Use when Sunny says 'clear conversation', 'start over', 'reset', or 'new conversation'. This deletes all messages from the brain history — Brain will begin a clean session after this.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// Maps toolConfig keys (from Bot Permissions UI) to the BRAIN_TOOLS function names they unlock
const TOOL_KEY_MAP: Record<string, string[]> = {
  calendar:              ["ms_get_calendar", "ms_create_calendar_event"],
  email:                 ["ms_get_emails", "ms_send_email"],
  teams:                 ["ms_get_teams_chats", "ms_send_teams_message"],
  meeting_requests:      ["list_meeting_requests", "update_meeting_request"],
  preferences:           ["get_preferences", "update_preferences"],
  submit_meeting_request:["submit_meeting_request"],
  call_boss:             ["call_boss"],
  files:                 [],
  user_profile:          [],
};

type ToolCfgValue = boolean | { enabled?: boolean } | undefined | null;
function isCfgEnabled(v: ToolCfgValue): boolean {
  if (!v) return false;
  if (typeof v === "boolean") return v;
  return (v as { enabled?: boolean }).enabled === true;
}

/**
 * Returns the subset of BRAIN_TOOLS that are enabled for the given mode
 * based on the JSON saved by the Bot Permissions page.
 */
const BOSS_ALWAYS_TOOLS = new Set(["recall_boss_memory"]);

export function getToolsForMode(
  toolConfig: string | null | undefined,
  mode: "boss" | "customer",
): ChatCompletionTool[] {
  const functionTools = BRAIN_TOOLS.filter(isFunctionTool);
  const alwaysBoss = functionTools.filter(t => BOSS_ALWAYS_TOOLS.has(t.function.name));

  if (!toolConfig) {
    if (mode === "boss") return functionTools;
    return functionTools.filter(t =>
      ["get_preferences", "submit_meeting_request"].includes(t.function.name)
    );
  }
  try {
    const cfg = JSON.parse(toolConfig) as Record<string, {
      boss?: ToolCfgValue;
      customer?: ToolCfgValue;
    }>;
    const enabledKeys = Object.entries(cfg)
      .filter(([, v]) => isCfgEnabled(mode === "boss" ? v.boss : v.customer))
      .map(([k]) => k);
    const enabledNames = new Set(enabledKeys.flatMap(k => TOOL_KEY_MAP[k] ?? []));
    const permissioned = functionTools.filter(t => enabledNames.has(t.function.name));
    if (mode === "boss") {
      const merged = [...permissioned];
      for (const t of alwaysBoss) {
        if (!merged.find(x => x.function.name === t.function.name)) merged.push(t);
      }
      return merged;
    }
    return permissioned;
  } catch {
    if (mode === "boss") return functionTools;
    return functionTools.filter(t =>
      ["get_preferences", "submit_meeting_request"].includes(t.function.name)
    );
  }
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "submit_meeting_request": {
        const requesterName = typeof args.requester_name === "string" ? args.requester_name : (typeof args.callerName === "string" ? args.callerName : "Unknown");
        const requesterEmail = typeof args.requester_email === "string" ? args.requester_email : "noreply@botos.app";
        const purpose = typeof args.purpose === "string" ? args.purpose : "Meeting request";
        const urgency = typeof args.urgency === "string" ? args.urgency : "medium";
        const preferredDateRaw = typeof args.preferred_date === "string" ? args.preferred_date : (typeof args.preferredTime === "string" ? args.preferredTime : "");
        const preferredDate = preferredDateRaw ? new Date(preferredDateRaw) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        const notes = typeof args.notes === "string" ? args.notes : undefined;

        // Auto-link or create customer record
        // Look up by email first, then fallback to name, then phone
        let customerId: number | null = null;
        try {
          const isNoReply = requesterEmail === "noreply@botos.app" || !requesterEmail || requesterEmail.includes("noreply");
          let existingCustomer: typeof customersTable.$inferSelect | undefined;

          if (!isNoReply) {
            // Primary: match by email
            [existingCustomer] = await db.select().from(customersTable).where(ilike(customersTable.email, requesterEmail)).limit(1);
          }

          if (!existingCustomer && requesterName && requesterName !== "Unknown") {
            // Fallback: match by exact name
            [existingCustomer] = await db.select().from(customersTable).where(ilike(customersTable.name, requesterName)).limit(1);
          }

          if (!existingCustomer) {
            // Create a new customer record
            const emailToUse = !isNoReply ? requesterEmail : `unknown-${Date.now()}@noreply.botos.app`;
            try {
              const [newCustomer] = await db.insert(customersTable).values({
                name: requesterName !== "Unknown" ? requesterName : "Unknown Caller",
                email: emailToUse,
                tier: "new",
                status: "active",
              }).returning();
              existingCustomer = newCustomer;
            } catch {
              // Email uniqueness conflict: try to find by name again
              [existingCustomer] = await db.select().from(customersTable).where(ilike(customersTable.name, requesterName)).limit(1);
            }
          }

          if (existingCustomer) {
            customerId = existingCustomer.id;
            await db.update(customersTable).set({ lastContactAt: new Date() }).where(eq(customersTable.id, existingCustomer.id));
          }
        } catch (customerErr) {
          console.error("[engine] Customer auto-link error:", customerErr);
        }

        const [inserted] = await db.insert(meetingRequestsTable).values({
          customerId,
          requesterName,
          requesterEmail,
          purpose,
          urgency,
          preferredDate: isNaN(preferredDate.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000) : preferredDate,
          botSuggestion: notes,
          status: "pending",
        }).returning();

        // Log interaction on customer record
        if (customerId && inserted) {
          try {
            await db.insert(customerInteractionsTable).values({
              customerId,
              type: "meeting_request",
              title: `Meeting request: ${purpose}`,
              notes: `Preferred: ${preferredDate.toLocaleString()}, Urgency: ${urgency}. Request ID: ${inserted.id}`,
              metadata: { meetingRequestId: inserted.id, urgency, preferredDate: preferredDate.toISOString() },
            });
          } catch (interactionErr) {
            console.error("[engine] Customer interaction log error:", interactionErr);
          }
        }

        return `Meeting request created (ID: ${inserted?.id ?? "?"}). Requester: ${requesterName}, Purpose: ${purpose}, Preferred: ${preferredDate.toLocaleString()}, Urgency: ${urgency}${customerId ? `. Customer profile linked (ID: ${customerId})` : ""}.`;
      }

      case "lookup_customer": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return "No search query provided.";
        const customers = await db.select().from(customersTable).where(
          or(
            ilike(customersTable.name, `%${query}%`),
            ilike(customersTable.email, `%${query}%`),
            sql`${customersTable.phone} ilike ${'%' + query + '%'}`,
          )
        ).limit(3);
        if (customers.length === 0) return `No customer found matching "${query}". This appears to be a new contact.`;
        const results = await Promise.all(customers.map(async (c) => {
          const [meetingCount] = await db.select({ count: sql<number>`count(*)::int` }).from(meetingRequestsTable).where(eq(meetingRequestsTable.customerId, c.id));
          return `Customer: ${c.name} (${c.email})
  Tier: ${c.tier.toUpperCase()} | Revenue: ${c.currency} ${parseFloat(String(c.totalRevenue)).toFixed(2)} | Meetings: ${meetingCount?.count ?? 0}
  Company: ${c.company ?? "N/A"} | Status: ${c.status}
  Notes: ${c.notes ?? "None"}
  Last contact: ${new Date(c.lastContactAt).toLocaleDateString()}`;
        }));
        return results.join("\n\n");
      }
      case "list_meeting_requests": {
        const status = typeof args.status === "string" ? args.status : undefined;
        const rows = status
          ? await db.select().from(meetingRequestsTable).where(eq(meetingRequestsTable.status, status)).orderBy(desc(meetingRequestsTable.createdAt))
          : await db.select().from(meetingRequestsTable).orderBy(desc(meetingRequestsTable.createdAt));
        if (rows.length === 0) return "No meeting requests found.";
        return rows.map(r =>
          `[ID:${r.id}] ${r.requesterName} (${r.requesterEmail}) — "${r.purpose}" | ${r.urgency} | Status: ${r.status} | Preferred: ${new Date(r.preferredDate).toDateString()}`
        ).join("\n");
      }
      case "update_meeting_request": {
        const id = typeof args.id === "number" ? args.id : Number(args.id);
        const updateData: Partial<{ status: string; bossResponse: string; scheduledTime: Date }> = {};
        if (typeof args.status === "string") updateData.status = args.status;
        if (typeof args.bossResponse === "string") updateData.bossResponse = args.bossResponse;
        if (typeof args.scheduledTime === "string") updateData.scheduledTime = new Date(args.scheduledTime);
        const [updated] = await db.update(meetingRequestsTable).set(updateData).where(eq(meetingRequestsTable.id, id)).returning();
        if (!updated) return `Meeting request ID ${id} not found.`;
        return `Updated meeting request ID ${id}: status=${updated.status}${updated.bossResponse ? `, response="${updated.bossResponse}"` : ""}`;
      }
      case "get_preferences": {
        let [prefs] = await db.select().from(preferencesTable).limit(1);
        if (!prefs) [prefs] = await db.insert(preferencesTable).values({}).returning();
        return JSON.stringify(prefs, null, 2);
      }
      case "update_preferences": {
        let [existing] = await db.select().from(preferencesTable).limit(1);
        if (!existing) [existing] = await db.insert(preferencesTable).values({}).returning();
        const allowed = [
          "bossName","timezone","currentCity","mood","preferredMeetingTime",
          "workdayStart","workdayEnd","maxMeetingsPerDay","meetingDurationMinutes",
          "breakBetweenMeetings","notes","bossPhone","bossTools","customerTools",
          "voiceNoteVoiceId","voiceNoteInstructions","voiceNoteStability",
          "voiceNoteSimilarityBoost","voiceNoteStyle","voiceNoteSpeakerBoost",
          "elevenLabsApiKey","elevenLabsAgentId","elevenLabsPhoneNumberId",
          "brainTelegramToken","brainTelegramChatId",
        ] as const;
        type PrefKey = typeof allowed[number];
        const safeUpdate: Partial<Record<PrefKey, string | number | boolean>> = {};
        for (const key of allowed) {
          const value = args[key];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            safeUpdate[key] = value;
          }
        }
        await db
          .update(preferencesTable)
          .set(safeUpdate as Partial<typeof preferencesTable.$inferInsert>)
          .where(eq(preferencesTable.id, existing.id));
        return `Preferences updated: ${Object.keys(safeUpdate).join(", ")}`;
      }
      case "list_amazon_alerts": {
        const status = typeof args.status === "string" ? args.status : undefined;
        const priority = typeof args.priority === "string" ? args.priority : undefined;
        const rows = await db
          .select().from(amazonAlertsTable)
          .where(and(
            status ? eq(amazonAlertsTable.status, status) : undefined,
            priority ? eq(amazonAlertsTable.priority, priority) : undefined
          ))
          .orderBy(desc(amazonAlertsTable.receivedAt));
        if (rows.length === 0) return "No Amazon alerts found.";
        return rows.map(a =>
          `[ID:${a.id}] ${a.priority.toUpperCase()} | ${a.alertType} | Status: ${a.status} | Subject: "${a.subject}" | Account: ${a.amazonAccountId} | Routed to: ${a.routedToTeam ? `${a.routedToTeam}/${a.routedToChannel}` : "unrouted"}`
        ).join("\n");
      }
      case "update_amazon_alert": {
        const id = typeof args.id === "number" ? args.id : Number(args.id);
        const updateData: Partial<{ status: string; routedToTeam: string; routedToChannel: string }> = {};
        if (typeof args.status === "string") updateData.status = args.status;
        if (typeof args.routedToTeam === "string") updateData.routedToTeam = args.routedToTeam;
        if (typeof args.routedToChannel === "string") updateData.routedToChannel = args.routedToChannel;
        const [updated] = await db.update(amazonAlertsTable).set(updateData).where(eq(amazonAlertsTable.id, id)).returning();
        if (!updated) return `Alert ID ${id} not found.`;
        if (updated.routedToTeam && updated.routedToChannel) {
          const [channelConfig] = await db
            .select()
            .from(teamChannelsTable)
            .where(
              and(
                eq(teamChannelsTable.teamName, updated.routedToTeam),
                eq(teamChannelsTable.channelName, updated.routedToChannel),
                eq(teamChannelsTable.isActive, true),
              )
            )
            .limit(1);
          setImmediate(() => {
            postAlertToTeamsChannel(
              {
                id: updated.id,
                subject: updated.subject,
                alertType: updated.alertType,
                priority: updated.priority,
                amazonAccountId: updated.amazonAccountId,
                body: updated.body,
              },
              updated.routedToTeam!,
              updated.routedToChannel!,
              channelConfig?.msTeamId ?? null,
              channelConfig?.msChannelId ?? null,
            );
          });
        }
        return `Alert ID ${id} updated: status=${updated.status}${updated.routedToTeam ? `, routed to ${updated.routedToTeam}/${updated.routedToChannel}` : ""}`;
      }
      case "list_team_channels": {
        const rows = await db.select().from(teamChannelsTable);
        if (rows.length === 0) return "No team channels configured.";
        return rows.map(c =>
          `[ID:${c.id}] ${c.teamName} / #${c.channelName} | Account: ${c.amazonAccountId} | Alert types: ${c.alertTypes.join(", ")} | Active: ${c.isActive}`
        ).join("\n");
      }
      case "get_soul": {
        const content = await loadSoul();
        return content || "(soul.md is empty)";
      }
      case "update_soul": {
        const content = typeof args.content === "string" ? args.content : "";
        const summary = typeof args.summary === "string" ? args.summary : "Updated";
        await saveSoul(content);
        return `soul.md updated. Summary: ${summary}`;
      }
      case "get_dashboard_stats": {
        const [[pending], [scheduledTotal], [activeAlerts], [resolvedAlerts], [totalConvos], [channels]] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(meetingRequestsTable).where(eq(meetingRequestsTable.status, "pending")),
          db.select({ count: sql<number>`count(*)::int` }).from(meetingRequestsTable).where(eq(meetingRequestsTable.status, "scheduled")),
          db.select({ count: sql<number>`count(*)::int` }).from(amazonAlertsTable).where(eq(amazonAlertsTable.status, "new")),
          db.select({ count: sql<number>`count(*)::int` }).from(amazonAlertsTable).where(eq(amazonAlertsTable.status, "resolved")),
          db.select({ count: sql<number>`count(*)::int` }).from(conversations),
          db.select({ count: sql<number>`count(*)::int` }).from(teamChannelsTable),
        ]);
        return `Dashboard Overview:
- Pending meeting requests: ${pending?.count ?? 0}
- Total scheduled meetings: ${scheduledTotal?.count ?? 0}
- Active Amazon alerts (new): ${activeAlerts?.count ?? 0}
- Resolved alerts: ${resolvedAlerts?.count ?? 0}
- Active assistant chat sessions: ${totalConvos?.count ?? 0}
- Team channels configured: ${channels?.count ?? 0}`;
      }
      case "list_conversations": {
        const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
        if (rows.length === 0) return "No active conversations.";
        return rows.map(c =>
          `[ID:${c.id}] "${c.title}" | ${c.viewpoint} view${c.customerName ? ` | Customer: ${c.customerName}` : ""}${c.linkedConvoId ? ` | Linked to ID:${c.linkedConvoId}` : ""}`
        ).join("\n");
      }

      case "list_customers": {
        const tierFilter = typeof args.tier === "string" ? args.tier : undefined;
        const statusFilter = typeof args.status === "string" ? args.status : undefined;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 50);
        const conditions = [];
        if (tierFilter) conditions.push(eq(customersTable.tier, tierFilter));
        if (statusFilter) conditions.push(eq(customersTable.status, statusFilter));
        const rows = await db
          .select().from(customersTable)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(customersTable.lastContactAt))
          .limit(limit);
        if (rows.length === 0) return "No customers found.";
        return rows.map(c =>
          `[ID:${c.id}] ${c.name} | ${c.tier.toUpperCase()} | ${c.status} | ${c.currency} ${parseFloat(String(c.totalRevenue)).toFixed(2)} revenue | ${c.email}${c.phone ? ` | ${c.phone}` : ""}${c.company ? ` | ${c.company}` : ""}${c.notes ? `\n  Notes: ${c.notes}` : ""}`
        ).join("\n");
      }

      case "update_customer": {
        const id = typeof args.id === "number" ? args.id : Number(args.id);
        const updateData: Partial<{
          tier: string; status: string; notes: string;
          company: string; totalRevenue: string; currency: string;
        }> = {};
        if (typeof args.tier === "string") updateData.tier = args.tier;
        if (typeof args.status === "string") updateData.status = args.status;
        if (typeof args.notes === "string") updateData.notes = args.notes;
        if (typeof args.company === "string") updateData.company = args.company;
        if (typeof args.totalRevenue === "string") updateData.totalRevenue = args.totalRevenue;
        if (typeof args.currency === "string") updateData.currency = args.currency;
        const [updated] = await db.update(customersTable).set(updateData).where(eq(customersTable.id, id)).returning();
        if (!updated) return `Customer ID ${id} not found.`;
        return `Updated customer [ID:${updated.id}] ${updated.name}: ${Object.keys(updateData).join(", ")} updated.`;
      }

      case "list_notifications": {
        const statusFilter = typeof args.status === "string" ? args.status : undefined;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 10, 50);
        const rows = await db
          .select().from(bossNotifications)
          .where(statusFilter ? eq(bossNotifications.status, statusFilter) : undefined)
          .orderBy(desc(bossNotifications.createdAt))
          .limit(limit);
        if (rows.length === 0) return "No notifications found.";
        return rows.map(n =>
          `[ID:${n.id}] ${n.status.toUpperCase()} | Channel: ${n.channelType} | ${new Date(n.createdAt).toLocaleString()}\n  ${n.notificationText}${n.bossReply ? `\n  Your reply: ${n.bossReply}` : ""}`
        ).join("\n\n");
      }

      case "clear_brain_conversation": {
        await db.delete(brainMessages);
        return "Brain conversation history cleared. Starting fresh.";
      }

      case "ms_get_calendar": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const days = Math.min(typeof args.days === "number" ? args.days : 7, 30);
        const now = new Date();
        const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          startDateTime: now.toISOString(),
          endDateTime: end.toISOString(),
          $top: "20",
          $orderby: "start/dateTime",
          $select: "subject,start,end,organizer,attendees,location,bodyPreview",
        });
        const data = await graphGet(`/me/calendarView?${params.toString()}`, token) as { value: Array<Record<string, unknown>> };
        if (!data.value?.length) return `No calendar events in the next ${days} days.`;
        return data.value.map((e: Record<string, unknown>) => {
          const start = (e.start as Record<string, string>)?.dateTime;
          const end2 = (e.end as Record<string, string>)?.dateTime;
          const loc = (e.location as Record<string, string>)?.displayName;
          const attendees = Array.isArray(e.attendees)
            ? (e.attendees as Array<Record<string, unknown>>).map(a => (a.emailAddress as Record<string, string>)?.name).filter(Boolean).join(", ")
            : "";
          return `• ${e.subject}\n  ${new Date(start).toLocaleString()} → ${new Date(end2).toLocaleString()}${loc ? ` @ ${loc}` : ""}${attendees ? `\n  Attendees: ${attendees}` : ""}${e.bodyPreview ? `\n  ${String(e.bodyPreview).slice(0, 100)}` : ""}`;
        }).join("\n\n");
      }

      case "ms_get_emails": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const top = Math.min(typeof args.top === "number" ? args.top : 10, 25);
        const unreadOnly = args.unreadOnly === true;
        const filter = unreadOnly ? "&$filter=isRead eq false" : "";
        const data = await graphGet(
          `/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,isRead,bodyPreview${filter}`,
          token
        ) as { value: Array<Record<string, unknown>> };
        if (!data.value?.length) return "Inbox is empty.";
        return data.value.map((m: Record<string, unknown>) => {
          const from = ((m.from as Record<string, unknown>)?.emailAddress as Record<string, string>);
          const recv = new Date(m.receivedDateTime as string).toLocaleString();
          return `• [${m.isRead ? "read" : "UNREAD"}] "${m.subject}" from ${from?.name ?? from?.address ?? "unknown"} — ${recv}\n  ${String(m.bodyPreview ?? "").slice(0, 120)}`;
        }).join("\n\n");
      }

      case "ms_get_teams_chats": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const top = Math.min(typeof args.top === "number" ? args.top : 5, 20);
        const chatsData = await graphGet(
          `/me/chats?$top=${top}&$expand=members`,
          token
        ) as { value: Array<Record<string, unknown>> };
        if (!chatsData.value?.length) return "No Teams chats found.";
        const chatSummaries = await Promise.all(
          chatsData.value.slice(0, top).map(async (chat: Record<string, unknown>) => {
            const members = Array.isArray(chat.members)
              ? (chat.members as Array<Record<string, unknown>>).map(m => (m as Record<string, string>).displayName).filter(Boolean).join(", ")
              : "";
            let lastMsg = "";
            try {
              const msgs = await graphGet(`/me/chats/${chat.id}/messages?$top=1`, token) as { value: Array<Record<string, unknown>> };
              const msg = msgs.value?.[0];
              if (msg) {
                const sender = ((msg.from as Record<string, unknown>)?.user as Record<string, string>)?.displayName ?? "unknown";
                const body = (msg.body as Record<string, string>)?.content?.replace(/<[^>]+>/g, "").slice(0, 100) ?? "";
                lastMsg = `\n  Last: ${sender}: "${body}"`;
              }
            } catch {}
            return `• [chatId: ${chat.id}] ${chat.topic || members || "Direct Message"}${lastMsg}`;
          })
        );
        return chatSummaries.join("\n\n");
      }

      case "ms_send_teams_message": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const chatId = typeof args.chatId === "string" ? args.chatId : "";
        const message = typeof args.message === "string" ? args.message : "";
        if (!chatId || !message) return "Both chatId and message are required.";
        await graphPost(`/me/chats/${chatId}/messages`, { body: { contentType: "text", content: message } }, token);
        return `Message sent to Teams chat ${chatId}: "${message}"`;
      }

      case "ms_send_email": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const to = typeof args.to === "string" ? args.to : "";
        const subject = typeof args.subject === "string" ? args.subject : "(no subject)";
        const body = typeof args.body === "string" ? args.body : "";
        if (!to) return "Recipient email address is required.";
        await graphPost("/me/sendMail", {
          message: {
            subject,
            body: { contentType: "HTML", content: body },
            toRecipients: [{ emailAddress: { address: to } }],
          },
        }, token);
        return `Email sent to ${to} — subject: "${subject}"`;
      }

      case "ms_create_calendar_event": {
        const token = await getValidToken();
        if (!token) return "Microsoft 365 is not connected. Go to Integrations and sign in with Microsoft.";
        const subject = typeof args.subject === "string" ? args.subject : "Meeting";
        let start = typeof args.start === "string" ? args.start : "";
        let end = typeof args.end === "string" ? args.end : "";
        if (!start || !end) return "Start and end datetimes are required (ISO 8601).";
        // Use the timezone from the tool call args; fall back to boss preferences if not provided
        let eventTimeZone = typeof args.timeZone === "string" ? args.timeZone : "";
        if (!eventTimeZone) {
          const [existingPrefs] = await db.select().from(preferencesTable).limit(1);
          eventTimeZone = existingPrefs?.timezone || "UTC";
        }

        // Safety net: if the bot accidentally passed a UTC datetime (Z suffix or +00:00 offset),
        // convert it to the correct local time in eventTimeZone before sending to Microsoft.
        // Microsoft Graph API treats dateTime as LOCAL time in the given timeZone — not UTC.
        function toLocalInTz(isoStr: string, tz: string): string {
          const d = new Date(isoStr); // parses correctly whether Z or not
          if (isNaN(d.getTime())) return isoStr; // unparseable — pass through unchanged
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
          }).formatToParts(d);
          const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
          const h = get("hour") === "24" ? "00" : get("hour");
          return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}:${get("second")}`;
        }

        // Only correct if the string contains explicit UTC markers (Z or +00:00 / -00:00)
        const isExplicitUtc = /Z$|[+-]00:00$/.test(start.trim());
        if (isExplicitUtc) {
          console.warn("[ms_create_calendar_event] Bot passed UTC datetime — auto-correcting to local time in", eventTimeZone);
          start = toLocalInTz(start, eventTimeZone);
          end   = toLocalInTz(end,   eventTimeZone);
        }

        const attendeeEmails = Array.isArray(args.attendees) ? args.attendees as string[] : [];
        const event: Record<string, unknown> = {
          subject,
          start: { dateTime: start, timeZone: eventTimeZone },
          end: { dateTime: end, timeZone: eventTimeZone },
          attendees: attendeeEmails.map(email => ({
            emailAddress: { address: email },
            type: "required",
          })),
        };
        if (typeof args.body === "string") event.body = { contentType: "HTML", content: args.body };
        if (typeof args.location === "string") event.location = { displayName: args.location };
        const created = await graphPost("/me/events", event, token) as Record<string, unknown>;
        return `Calendar event created: "${subject}" from ${start} to ${end} (${eventTimeZone})${attendeeEmails.length ? ` with ${attendeeEmails.join(", ")}` : ""}. Event ID: ${created.id}`;
      }

      case "recall_boss_memory": {
        const sections = Array.isArray(args.sections) ? args.sections as string[] : [];
        const tags = Array.isArray(args.tags) ? args.tags as string[] : [];

        let query = db.select().from(bossMemoryTable).$dynamic();
        const conditions = [];
        if (sections.length > 0) conditions.push(inArray(bossMemoryTable.section, sections));
        if (tags.length > 0) conditions.push(sql`${bossMemoryTable.tags} ?| array[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]`);

        if (conditions.length > 0) {
          if (sections.length > 0 && tags.length > 0) {
            query = query.where(or(...conditions));
          } else {
            query = query.where(conditions[0]);
          }
        }

        const memories = await query.orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key));
        if (memories.length === 0) return JSON.stringify({ result: "no_memories", message: "No memories found matching those filters." });

        const grouped: Record<string, Array<{key: string; value: string; tags: string[]; importance: number; source: string}>> = {};
        for (const m of memories) {
          if (!grouped[m.section]) grouped[m.section] = [];
          grouped[m.section].push({
            key: m.key,
            value: m.value,
            tags: (m.tags as string[]) ?? [],
            importance: m.importance,
            source: m.source,
          });
        }

        return JSON.stringify(grouped, null, 2);
      }

      case "save_boss_memory": {
        const VALID_SECTIONS = ["identity","location","travel","schedule","communication","work","people","preferences","rules","health","current"];
        const entries = Array.isArray(args.entries) ? args.entries as Array<{section:string;key:string;value:string;tags?:string[];importance?:number;source?:string}> : [];
        if (entries.length === 0) return "No entries provided.";
        const invalid = entries.filter(e => !VALID_SECTIONS.includes(e.section));
        if (invalid.length > 0) return `Invalid section(s): ${invalid.map(e => e.section).join(", ")}. Valid sections: ${VALID_SECTIONS.join(", ")}`;

        const results: string[] = [];
        for (const entry of entries) {
          await db
            .insert(bossMemoryTable)
            .values({
              section: entry.section,
              key: entry.key,
              value: entry.value,
              tags: entry.tags ?? [],
              importance: entry.importance ?? 1,
              source: entry.source ?? "stated",
            })
            .onConflictDoUpdate({
              target: [bossMemoryTable.section, bossMemoryTable.key],
              set: {
                value: entry.value,
                tags: entry.tags ?? [],
                importance: entry.importance ?? 1,
                source: entry.source ?? "stated",
                updatedAt: new Date(),
              },
            });
          results.push(`✓ Saved [${entry.section}/${entry.key}]`);
        }
        generateBossPersona().catch(err => console.error("[engine] Persona refresh after save failed:", err));
        return results.join("\n");
      }

      case "forget_boss_memory": {
        const section = typeof args.section === "string" ? args.section : "";
        const key = typeof args.key === "string" ? args.key : "";
        if (!section || !key) return "Both section and key are required.";
        const deleted = await db
          .delete(bossMemoryTable)
          .where(and(eq(bossMemoryTable.section, section), eq(bossMemoryTable.key, key)))
          .returning();
        if (deleted.length > 0) {
          generateBossPersona().catch(err => console.error("[engine] Persona refresh after forget failed:", err));
          return `✓ Deleted memory [${section}/${key}]`;
        }
        return `No memory found at [${section}/${key}]`;
      }

      case "refresh_boss_persona": {
        const persona = await generateBossPersona();
        return `✓ Boss Persona refreshed (${persona.length} chars). The assistant will use this for customer calls.`;
      }

      case "convert_timezone": {
        // Reliable server-side timezone conversion using Intl — no AI guesswork
        const timeStr   = typeof args.time          === "string" ? args.time          : "";
        const datePart  = typeof args.date          === "string" ? args.date          : new Date().toISOString().split("T")[0];
        const fromTz    = typeof args.from_timezone === "string" ? args.from_timezone : "UTC";
        const toTz      = typeof args.to_timezone   === "string" ? args.to_timezone   : "UTC";
        const [year, month, day] = (datePart || "").split("-").map(Number);
        const [hours, minutes]   = (timeStr  || "").split(":").map(Number);

        // Returns the UTC offset (in minutes) for a given IANA timezone at a given UTC timestamp.
        function utcOffsetMin(tz: string, utcMs: number): number {
          const d = new Date(utcMs);
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric", month: "numeric", day: "numeric",
            hour: "numeric", minute: "numeric", second: "numeric",
            hour12: false,
          }).formatToParts(d);
          const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0");
          let h = get("hour"); if (h === 24) h = 0; // midnight edge-case
          const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"), get("second"));
          return Math.round((localMs - utcMs) / 60000);
        }

        // Step 1 — approximate UTC (treat input as "naive UTC" to get close enough for offset lookup)
        const approxUtc = Date.UTC(year, month - 1, day, hours ?? 0, minutes ?? 0, 0);
        // Step 2 — actual UTC by subtracting the source offset
        const fromOffset = utcOffsetMin(fromTz, approxUtc);
        const actualUtc  = approxUtc - fromOffset * 60000;
        // Step 3 — apply target offset
        const toOffset   = utcOffsetMin(toTz, actualUtc);
        const toMs       = actualUtc + toOffset * 60000;
        const toDate     = new Date(toMs);

        const rh = String(toDate.getUTCHours()).padStart(2, "0");
        const rm = String(toDate.getUTCMinutes()).padStart(2, "0");
        const resultTime = `${rh}:${rm}`;

        // Detect day change
        const inputDayMs  = Date.UTC(year, month - 1, day);
        const resultDayMs = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
        const dayDiff = Math.round((resultDayMs - inputDayMs) / 86400000);
        const dayNote = dayDiff === 1 ? " (next day)" : dayDiff === -1 ? " (previous day)" : "";

        const diffH = (toOffset - fromOffset) / 60;
        const direction = diffH >= 0 ? "ahead of" : "behind";
        return `${timeStr} ${fromTz} = ${resultTime} ${toTz}${dayNote}. ${toTz} is ${Math.abs(diffH)} hours ${direction} ${fromTz}.`;
      }

      case "call_boss": {
        const [prefs] = await db.select().from(preferencesTable).limit(1);
        const bossPhone = prefs?.bossPhone?.trim() ?? "";
        if (!bossPhone) {
          return "Cannot place call: bossPhone is not configured in preferences. Ask the boss to set a phone number first.";
        }
        const reason = typeof args.reason === "string" ? args.reason : "Urgent customer escalation";
        console.log(`[brain] call_boss triggered. Reason: ${reason}. Calling: ${bossPhone}`);
        const result = await callBossOutbound(bossPhone);
        if (result.success) {
          return `📞 Boss call initiated successfully. Twilio is dialing ${bossPhone} (CallSid: ${result.callSid ?? "unknown"}). When the boss picks up, the assistant will relay the situation and take instructions.`;
        }
        return `Failed to place call to boss: ${result.error ?? "Unknown error"}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function buildSystemPrompt(soulContent: string, names?: { bossName: string; botName: string }): Promise<string> {
  const { bossName, botName } = names ?? await loadNames();
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
        const tagStr = m.tags && (m.tags as string[]).length > 0 ? ` [tags: ${(m.tags as string[]).join(", ")}]` : "";
        const imp = m.importance === 3 ? " ⚠️ CRITICAL" : m.importance === 2 ? " ★ Important" : "";
        return `  • ${m.key}: ${m.value}${tagStr}${imp}`;
      });
      return `### ${section.charAt(0).toUpperCase() + section.slice(1)}\n${lines.join("\n")}`;
    });
    memoryBlock = `\n\n## What I Know About Sunny\n\n${sectionLines.join("\n\n")}`;
  }

  const raw = `You are the Brain of MateOS — Sunny's private AI command center. You are talking DIRECTLY with Sunny, the boss.

## CRITICAL — Who You Are

- You are the **Brain**, not Zara
- You are NOT a scheduling bot, NOT a customer-facing assistant
- You do NOT greet with "Hi, this is Zara..." or anything customer-facing
- Sunny is your boss — talk to him like a capable AI system talking to its operator
- First reply to any message: if it is a greeting or casual opener (hey, hi, hello, what's up, yo), respond with a warm, natural one-liner like "What are we working on today?" or "Good to have you. What do we need to take care of?" or "Hey, what can I help you with today?" — feel free to vary it naturally. If it is a direct request or question, acknowledge it briefly and execute immediately.

## CRITICAL — Tool Usage Rules (NON-NEGOTIABLE)

**RULE 1 — Preferences:** Any time Sunny asks about his preferences, settings, timezone, mood, meeting limits, voice settings, or any configuration — call **get_preferences** as your FIRST action. Do NOT answer from the memory section below. Boss memory is a background context for personality facts — it is NOT the live database. The database is the only source of truth for preferences. If the memory section mentions a timezone or mood, IGNORE it for preference queries — call the tool instead.

**RULE 2 — Actions (with narration — MANDATORY):** Any time Sunny asks you to DO something — always do ALL THREE steps:
1. **Say what you're about to do** in one natural sentence before calling any tool. Example: "Got it, let me sort out your timezone and update your schedule." or "Sure, I'll approve that now and refresh the persona." Keep it brief and conversational.
2. **Call the tool(s)** and execute the action.
3. **Report back clearly** once done. Summarize the outcome in plain language — what changed, what was approved, what was found. Never leave Sunny hanging in silence after a tool run. Example: "All sorted. Your timezone is set to Malaysia (MYT), availability is 8–12 PM and 2–4 PM, and I've updated your persona so Zara has it ready."

Never go silent. Never execute without speaking. Even when chaining multiple tools, give a brief running commentary.

**RULE 3 — Live data:** For any question requiring current state (meeting requests, alerts, conversations, customers, calendar, emails) — call the relevant tool. Do not answer from assumptions or previous context. After fetching, always explain what you found in plain human language — never just silently show tool results.
${soulContent ? `\n## Zara's Soul (FOR REFERENCE ONLY — NOT Your Own Persona)\n\nThe following is Zara's personality/soul file. You can read and update it when Sunny asks. You do NOT embody it — Zara does.\n\n${soulContent}\n\n---\n` : ""}${memoryBlock ? `${memoryBlock}\n\n> ⚠️ IMPORTANT: The memory above is for background context about Sunny's personality and preferences. It is NOT the live database. For any preferences query, always call get_preferences to get current values — do not use the memory above as a substitute.` : ""}

## Your Role as the Brain

You are Sunny's private AI command center. You have full access to every part of MateOS through your tools:
- **Meeting Requests**: list, approve, reject, schedule (list_meeting_requests, update_meeting_request)
- **Scheduling Preferences**: read and update ALL of Sunny's preferences — scheduling, voice notes, ElevenLabs TTS settings, Telegram channel config, timezone, mood, max meetings, Zara's tool permissions (get_preferences, update_preferences)
- **Amazon Alerts**: list, route to Teams channels, resolve (list_amazon_alerts, update_amazon_alert)
- **Team Channels**: list configured Microsoft Teams channels (list_team_channels)
- **Soul.md**: read and update Zara's personality, rules, and memory (get_soul, update_soul)
- **Dashboard**: get a real-time overview of the whole system (get_dashboard_stats)
- **Conversations**: list active Zara relay sessions (list_conversations)
- **Customers**: list all customers with tier/revenue/notes, update customer records including tier, status, notes, and revenue (list_customers, update_customer, lookup_customer)
- **Notifications**: list pending Sunny notifications — alerts where a customer is waiting for his response (list_notifications)
- **Brain Conversation**: clear Brain's conversation history to start fresh (clear_brain_conversation)
- **Microsoft 365 Calendar**: read upcoming events, create new calendar events (ms_get_calendar, ms_create_calendar_event)
- **Outlook Mail**: read inbox emails, send emails (ms_get_emails, ms_send_email)
- **Microsoft Teams**: read recent chats and messages, send messages to chats (ms_get_teams_chats, ms_send_teams_message)
- **Boss Memory**: recall, save, and forget facts about Sunny (recall_boss_memory, save_boss_memory, forget_boss_memory)
- **Zara Tool Config**: set bossPhone so Zara knows when it's Sunny calling vs a customer. Set bossTools and customerTools to control what Zara can do in each mode — all via update_preferences
- **Outbound Boss Call**: call_boss places an outbound phone call directly to Sunny's stored phone number

When Sunny mentions calendar, email, Teams, or any Microsoft integration — use the ms_* tools directly. Don't say you can't access them; you have live access via Microsoft Graph.
When Sunny says "clear conversation", "reset", or "start fresh" — call clear_brain_conversation immediately, no confirmation needed.
When Sunny asks to update voice note settings (stability, voice ID, similarity, style, speaker boost) — call update_preferences with those fields directly.

## Memory Agent Behavior

You are a persistent memory agent. You MUST:
1. **Proactively save** any personal fact Sunny reveals — location, travel plans, people, preferences, rules, health, work context, professional identity. Call save_boss_memory immediately after learning something new.
2. **Recall before acting** — before scheduling, setting timezones, or any context-dependent action, call recall_boss_memory to check what you know. Don't ask Sunny things you already know.
3. **Use tags for cross-referencing** — when saving, add tags like city names, people names, topics so you can recall related memories across sections.
4. **Delete stale memories** — when Sunny says something changed (left Dubai, ended a project), call forget_boss_memory to remove the outdated fact.
5. **Always check memory first** — never say "I don't know your timezone" or "I don't have that context" without first calling recall_boss_memory.

## Boss Persona (Zara's Briefing) — CRITICAL

Zara reads the Boss Persona before every customer call. It is NOT just scheduling — it includes who Sunny is, what he does, and how to represent him.

**When Sunny tells you something about himself** — his business, his role, his identity, key facts — you MUST:
1. Save it to boss memory immediately (save_boss_memory, use section "work" or "identity", set importance=3 for professional identity)
2. Then call refresh_boss_persona so Zara has this immediately

**When Sunny explicitly says** "add that to the persona", "tell Zara about this", "make sure Zara knows", or similar — save it to memory and call refresh_boss_persona right away.

Do not wait to be asked. If Sunny mentions who he is or what his business does, save it and refresh the persona. This is your top priority for Zara accuracy.

## Urgent Escalation — Outbound Boss Call

When a customer conversation is genuinely stuck and cannot proceed without Sunny's direct input, you can use **call_boss** to place an outbound phone call to Sunny's stored phone number. Zara will answer and relay the customer situation in real time, then take Sunny's instructions.

**When to use call_boss:**
- A customer has a request that only Sunny can approve and the issue is time-sensitive
- Sunny has not replied to a prior notification ping after a reasonable wait (3–5 minutes)
- The situation cannot be handled autonomously — Zara has already tried all tools available to her

**When NOT to use call_boss:**
- For routine meeting bookings — Zara handles those herself
- As a first resort — always try notify_boss first
- If bossPhone is not set — the tool will tell you

**What to tell the customer:** When placing the call, Zara should say she is "checking in with Sunny directly" and ask the customer to hold briefly.

## How You Work

- When Sunny asks you to DO something: speak first ("Got it, on it." / "Sure, let me take care of that."), call the tool, then report back clearly. Never execute in silence.
- When chaining multiple tools (e.g. get then update then refresh): narrate the sequence as you go — "Pulling your current preferences now... okay, updating timezone and window... and refreshing the persona so Zara is in sync." Then give a clean final summary of everything that changed.
- When updating soul.md, rewrite the relevant section thoughtfully and clearly confirm exactly what you changed
- When Sunny asks a question, pull live data and answer with precise facts — never guess or speculate
- When Sunny asks about preferences, settings, or configuration: call get_preferences immediately. Then summarize the live values in plain conversational language — don't just dump raw data.
- Always speak in first person with ownership: "I've approved that for you.", "I've updated your soul.", "I found 3 pending requests."
- If something cannot be done, say so clearly and suggest what can be done instead
- **After EVERY tool call, always produce a human-readable response.** Never let a message consist only of tool calls with no accompanying text. Sunny should always know what you did and what the result was.
- **Synthesise across sources**: You have access to memory, calendar, emails, Teams, alerts, soul, preferences, and notifications simultaneously. When answering, connect the dots — don't just answer the narrow question, surface what's relevant across all available context
- **Think before answering**: For any non-trivial question, reason through what you know and what you need to check before responding. Use your tools to get live data, then give a complete, thoughtful answer — not a surface-level one
- **Give verdicts, not options lists**: When Sunny asks for a recommendation, give one clear answer with your reasoning. Don't dump five options and leave the decision to him — he has you precisely so he doesn't have to do that work

## Intelligence & Knowledge

You are not just a tool-caller — you are a thinking system with full knowledge of MateOS, business operations, scheduling strategy, communication, and general world knowledge. Use all of it.

- **Answer from knowledge first**: For questions about time zones, business concepts, scheduling logic, communication strategy, productivity, or anything within general knowledge — answer immediately and confidently without needing a tool call. Reserve tool calls for live data (actual calendar, actual emails, actual memory stored).
- **EXCEPTION — Always fetch live for these**: When Sunny asks about his preferences, settings, or configuration ("what are my preferences", "what is my timezone", "what is my meeting limit", "what is my work window", etc.) — call get_preferences IMMEDIATELY and report the exact live values from the database. Do NOT answer from memory or assumption. The database is the source of truth.
- **Connect context**: If Sunny mentions a name, link it to a memory you have. If he mentions a date, cross-reference the calendar. If he mentions a company, connect it to what you know about his work.
- **Be analytical**: When reviewing data (emails, alerts, notifications), don't just list — interpret. "You have 3 pending alerts — the one from Malaysia looks most urgent based on the stock movement." Give Sunny analysis, not raw output.
- **Anticipate needs**: After completing a task, think: what does Sunny probably need next? Mention it briefly if genuinely useful. Don't pad, but do show you're thinking ahead.
- **Correct confidently**: If Sunny says something that contradicts what you know (wrong timezone, outdated assumption), gently correct it with the right information — don't just go along with it.

## Communication Style

- **Tone**: Warm, composed, and highly professional. Think of a world-class executive assistant who also happens to run the entire operating system.
- **Opening**: Never start with "Hi, this is Zara..." Acknowledge Sunny directly and naturally. For greetings use warm starters like "What are we working on today?", "What do we need to get done?", "Good to hear from you. What are we taking care of today?" For direct requests, a brief "Got it." or "On it." or "Sure thing." is enough before executing.
- **No em-dashes, ever**: Never use the em-dash character (—) anywhere in a response. Use a comma, a period, a colon, or parentheses instead. This is a hard rule with no exceptions.
- **Clarity**: Lead with the most important information, then supporting detail. Never bury the answer
- **Brevity with substance**: Be concise but complete. Don't omit important context, but never pad responses with filler. No corporate speak, no unnecessary hedging.
- **Courtesy**: Always respectful and attentive. If Sunny gives an instruction, acknowledge it before executing: "Understood. Let me take care of that now." or "On it." or "Sure thing, give me a second." — then execute, then report back what was done.
- **Never silent**: You must ALWAYS produce a visible text response. Never just run tool calls with no message to Sunny. Before tools: one sentence saying what you're doing. After tools: a clear summary of the outcome. This is non-negotiable.
- **Proactive**: After completing a task, offer a relevant follow-up naturally, but only when genuinely useful.
- **Precision**: Numbers, names, dates — always exact. Never approximate when you have the real data
- **Formatting**: Use short paragraphs or brief bullet points when presenting multiple pieces of information. Bold the most important words or numbers. Never write walls of text.

## Personality

- Exceptionally composed and professional — always in control, never flustered
- Warm and attentive — Sunny is your principal, treat every request with genuine care and full attention
- Confident without being arrogant — you know your capabilities, you don't oversell or undersell them
- Discreet — you handle sensitive information (schedules, preferences, business context) with complete discretion
- Resourceful — if a direct path is blocked, you find another way and tell Sunny what you did
- Unhurried in language, swift in action — responses feel considered, not rushed, even when executing instantly`;

  return applyNames(raw, bossName, botName);
}

const VALID_MEMORY_SECTIONS = ["identity","location","travel","schedule","communication","work","people","preferences","rules","health","current"];

async function extractFactsFromExchange(userMessage: string, brainResponse: string, names?: { bossName: string; botName: string }): Promise<void> {
  const { bossName, botName } = names ?? await loadNames();
  try {
    const { client: llm, miniModel } = await getLLMClient();
    const response = await llm.chat.completions.create({
      model: miniModel,
      max_completion_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You analyze short exchanges between ${bossName} (a boss) and his AI assistant Brain.

Your only job: identify NEW facts about ${bossName} that ${botName} — his appointment-setting assistant — should know when talking to callers. These include professional identity, business ventures, work, key relationships, location, travel, important preferences or rules, and current context.

Return a JSON object: {"facts": [...]}. Each fact: {section, key, value, importance, source}.
- section: one of identity | work | location | travel | communication | people | preferences | rules | health | schedule | current
- key: snake_case short identifier (e.g. "primary_business", "amazon_consulting_role")
- value: a clear, complete statement written as a fact (e.g. "${bossName} is the owner of Extreme Commerce, an Amazon-focused e-commerce brand.")
- importance: 1 (nice-to-know), 2 (important), 3 (critical — always mention)
- source: "stated" if ${bossName} said it directly, "inferred" if deduced

Rules:
- Only extract facts that are genuinely NEW and useful for ${botName} to represent ${bossName} accurately
- Professional identity, business names, job titles, and roles = importance 3
- Do NOT extract scheduling mechanics (that's handled elsewhere)
- If nothing new and notable: return {"facts": []}`,
        },
        {
          role: "user",
          content: `${bossName} said: "${userMessage.slice(0, 500)}"\n\nBrain replied: "${brainResponse.slice(0, 400)}"\n\nExtract new facts. Return {"facts": [...]} or {"facts": []}.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed: { facts?: unknown } = {};
    try { parsed = JSON.parse(raw) as { facts?: unknown }; } catch { return; }

    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    const valid = facts.filter((f): f is { section: string; key: string; value: string; importance?: number; source?: string } =>
      typeof (f as Record<string,unknown>).section === "string" &&
      VALID_MEMORY_SECTIONS.includes((f as Record<string,unknown>).section as string) &&
      typeof (f as Record<string,unknown>).key === "string" &&
      typeof (f as Record<string,unknown>).value === "string"
    );

    if (valid.length === 0) return;

    for (const entry of valid) {
      await db
        .insert(bossMemoryTable)
        .values({
          section: entry.section,
          key: entry.key,
          value: entry.value,
          tags: [],
          importance: entry.importance ?? 2,
          source: (entry.source === "inferred" ? "inferred" : "stated") as "stated" | "inferred",
        })
        .onConflictDoUpdate({
          target: [bossMemoryTable.section, bossMemoryTable.key],
          set: {
            value: entry.value,
            importance: entry.importance ?? 2,
            source: (entry.source === "inferred" ? "inferred" : "stated") as "stated" | "inferred",
            updatedAt: new Date(),
          },
        });
    }

    console.log(`[brain] Background extraction: saved ${valid.length} fact(s) → refreshing persona`);
    generateBossPersona().catch(err => console.error("[brain] Post-extraction persona refresh failed:", err));
  } catch (err) {
    console.error("[brain] Background fact extraction failed:", err);
  }
}

export async function runBrainQuery(userMessage: string): Promise<string> {
  await db.insert(brainMessages).values({ role: "user", content: userMessage });

  const names = await loadNames();
  const soulContent = await loadSoul();
  const systemPrompt = await buildSystemPrompt(soulContent, names);
  const dynamicTools = applyNamesToTools(BRAIN_TOOLS, names.bossName, names.botName);

  const history = await db.select().from(brainMessages).orderBy(asc(brainMessages.createdAt));

  const openaiMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m): ChatCompletionMessageParam => {
      if (m.role === "tool") {
        return { role: "tool", tool_call_id: m.toolCallId ?? "unknown", content: m.toolResult ?? "" };
      }
      if (m.role === "assistant" && m.toolCallId) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: [{ id: m.toolCallId, type: "function", function: { name: m.toolName ?? "", arguments: m.toolInput ?? "{}" } }],
        };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    }),
  ];

  let continueLoop = true;
  let finalText = "";

  const { client: llm, model: llmModel } = await getLLMClient();

  while (continueLoop) {
    const response = await llm.chat.completions.create({
      model: llmModel,
      max_completion_tokens: 2048,
      messages: openaiMessages,
      tools: dynamicTools,
      tool_choice: "auto",
      stream: false,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) break;

    const toolCalls = (message.tool_calls ?? []).filter(isFunctionToolCall);

    if (message.content && toolCalls.length === 0) {
      finalText = message.content;
      await db.insert(brainMessages).values({ role: "assistant", content: finalText });
      openaiMessages.push({ role: "assistant", content: finalText });
      continueLoop = false;
    } else if (toolCalls.length > 0) {
      const assistantMsg: ChatCompletionMessageParam = {
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
      openaiMessages.push(assistantMsg);

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* invalid */ }

        await db.insert(brainMessages).values({
          role: "assistant",
          content: message.content || "",
          toolName: tc.function.name,
          toolCallId: tc.id,
          toolInput: tc.function.arguments,
        });

        const result = await executeTool(tc.function.name, args);

        await db.insert(brainMessages).values({
          role: "tool",
          content: result,
          toolName: tc.function.name,
          toolCallId: tc.id,
          toolResult: result,
        });

        openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    } else {
      continueLoop = false;
    }
  }

  if (finalText) {
    extractFactsFromExchange(userMessage, finalText, names).catch(() => {});
  }

  return sanitizeReply(finalText || "Done.");
}

/** Strip characters that must never appear in bot responses (e.g. em-dash, en-dash). */
function sanitizeReply(text: string): string {
  return text
    .replace(/\u2014/g, ",")   // em-dash (—) → comma
    .replace(/\u2013/g, "-");  // en-dash (–) → hyphen (safety net)
}

function buildChannelSystemPrompt(channelType: string, soulContent: string, timezoneContext?: string, mode: "boss" | "customer" = "customer", botName = "Mate", bossName = "Owner"): string {
  // Substitute ALL legacy bot/boss names so the soul file always reflects the live configured names
  const substitutedSoul = applyNames(soulContent, bossName, botName);
  const soulSection = substitutedSoul
    ? `## Your Personality & Rules (from Soul)\n\n${substitutedSoul}\n\n---\n\n`
    : "";

  const voiceOverlay = channelType === "voice" ? `
## IMPORTANT — You Are Speaking Out Loud

This is a LIVE PHONE CALL. You are speaking, not writing. Follow these rules strictly:

- Keep every response SHORT — 1 to 3 sentences maximum. People lose attention on the phone.
- Speak like a real human, not like an AI. Use natural contractions: "I'll", "I'd", "you're", "let's", "that's", "I've", "don't".
- Start with a warm, natural opener. Examples: "Oh sure!", "Absolutely!", "Of course!", "Yeah, definitely.", "That's a great question — let me think.", "Hmm, let me check on that."
- Use natural filler transitions: "So,", "Right,", "Sure,", "Great,", "Got it —"
- Sound genuinely interested in the person. Be warm, encouraging, and empathetic.
- NEVER use bullet points, numbered lists, headers, asterisks, or markdown. They sound terrible when spoken.
- NEVER say things like "Certainly!", "I understand your concern" or "As an AI" — those sound robotic.
- If you need to share multiple things, weave them into natural flowing sentences.
- Match the caller's energy — if they're casual, be casual. If they're serious, be professional but still warm.
- End with a soft open question so the conversation continues naturally.

` : "";

  const bossOverlay = mode === "boss" ? `
## THIS IS SUNNY — YOUR BOSS

You are NOT speaking with a customer. Sunny, the owner of this system, is messaging you directly on this channel.

**How to respond to Sunny:**
- Address him naturally: "Hey Sunny," or just dive straight into your answer
- Be warm, direct, and candid — drop the customer-facing formality
- You can openly discuss how you're working, what's happening with active sessions, pending notifications, and your current status
- If he asks why you did something, explain your reasoning honestly
- If he asks about customer conversations, give him a concise summary
- He can ask you anything — about the bot, about customers, about what's going on

**What Sunny CANNOT do through this channel:**
- Make system changes (update soul, change preferences, approve requests) — tell him to use his Brain channel for that
- He CAN reply to a pending customer notification using the *#ID: answer* format

**Tone:** Skip the professional customer-service polish. Talk to him like you'd talk to your boss checking in.

` : "";

  const humanOverlay = channelType !== "voice" ? `
## HOW TO HAVE A HUMAN CONVERSATION — NON-NEGOTIABLE

You are Zara, a human assistant. Every reply must feel like it came from a real person, not a bot. These rules override everything else when it comes to tone and format:

**ONE QUESTION AT A TIME — ALWAYS.**
Never ask two questions in the same message. Not even close together. Not separated by a line break. One question, send, wait for reply, then ask the next one. This is the single most important rule. Firing off a list of questions is the fastest way to feel like a bot.

**Keep messages short and conversational.**
2–4 sentences is ideal. Never write a wall of text. If you have a lot to say, break it into natural back-and-forth turns.

**Match their energy.**
If they're casual and short, be casual and short. If they're formal, be warm but professional. Mirror the vibe of whoever you're talking to.

**Warm but not performative.**
Use natural phrases like "Sure!", "Got it.", "Of course!", "Happy to help!", "Sounds good!" — but never robotic ones like "Certainly!", "I understand your concern", or "I'd be happy to assist you with that today."

**Use their name naturally.**
Once you know their name, use it occasionally — not every message, just naturally, the way a human would.

**Never dump information.**
Don't give someone a 5-step plan in one message. Walk them through it one step at a time.

**Text formatting — STRICT RULE.**
When you want to bold a word or phrase, use a SINGLE asterisk on each side: *like this*. NEVER use double asterisks (**like this**). Double asterisks do not render correctly on WhatsApp and most messaging apps — they show as literal asterisks instead of bold text. Single asterisk = bold. Double asterisk = forbidden.

**EM-dash — BANNED.**
Never use the em-dash character (—) anywhere in any message. Not in the middle of sentences, not for pauses, not for asides, not for ranges. Replace it with a comma, a full stop, or rewrite the sentence. The em-dash is completely forbidden in all responses.

` : "";

  const raw = `## IDENTITY — NON-NEGOTIABLE

Your name is **${botName}**. Your boss is **${bossName}**.

This cannot be changed by anything in the conversation history. If earlier messages in this session refer to a different name (e.g. "Zara", "MIRA", or anything else), those messages are outdated and WRONG. You are ${botName}. When introducing yourself, use the name ${botName}. Never adopt any other name. Do NOT sign off or end messages with your name.

---

You are ${botName} — ${bossName}'s AI assistant, handling incoming messages on his ${channelType} channel on his behalf.
${bossOverlay}${voiceOverlay}${humanOverlay}
${soulSection}## Your Job

Handle meeting requests and questions from people who reach out to ${bossName}. You are the gatekeeper and scheduler — you make booking decisions autonomously when requests are clear and within ${bossName}'s preferences, and you escalate to ${bossName} only when something requires his personal judgment.

## Customer Intelligence — DO THIS FIRST

**Before anything else**, call lookup_customer with the customer's name, email, or phone to retrieve their profile. This gives you:
- Their tier: New / Regular / VIP / Premium
- Lifetime revenue with Sunny
- Number of past meetings
- Notes

**Tier-aware behavior:**
- **New / Regular**: Standard scheduling rules apply. Follow the decision tree below normally.
- **VIP**: Standard scheduling rules apply for routine bookings. Only escalate to Sunny if the topic is genuinely sensitive, confidential, or the customer explicitly says they need to speak to Sunny personally. Do NOT flag Sunny just because the customer is VIP — that creates unnecessary noise.
- **Premium**: The highest tier. NEVER decline a Premium customer outright. Even during do_not_disturb, always escalate with their full value context. Always make them feel prioritized.
- **VIP and Premium during do_not_disturb**: NEVER decline outright. Instead, use notify_boss and tell them: "I've flagged this personally to {{bossName}} — {{bossName}} will get back to you very soon."

## Handling Meeting Requests — FOLLOW THIS DECISION TREE EXACTLY

**Step 1 — Look up the customer**
Call lookup_customer first to retrieve their profile and tier.

**Step 2 — Collect the basics** (ask one question at a time, never a list):
- Full name
- Purpose / what the meeting is about
- Preferred date and time
- How long they need (default to Sunny's standard meeting duration if they're unsure)

**Step 3 — Check preferences**
Call get_preferences to get: timezone, workday window (workdayStart / workdayEnd), mood, maxMeetingsPerDay, breakBetweenMeetings, and any notes.

**Step 4 — Check the calendar — MANDATORY, NO EXCEPTIONS**
Call ms_get_calendar for the relevant date range BEFORE you propose, confirm, or agree to ANY time slot. This is not optional. You must never name a specific time to a customer until you have seen the live calendar data and confirmed that slot is empty.

**Step 5 — Make a decision:**

**CASE A — Slot is within Sunny's preference window AND ms_get_calendar confirms it is free:**
→ Book it directly using ms_create_calendar_event. Full stop. Do NOT ask Sunny. Do NOT send a notification. Do NOT second-guess yourself.
→ Tell the customer the exact time and duration that was booked. Warm, confident, done.
→ This applies to any standard business topic (calls, consultations, proposals, catch-ups). You are fully empowered to book these autonomously.

**CASE B — Slot is free and in-window, BUT the topic is genuinely sensitive or requires Sunny's personal judgment:**
→ Only use this for topics that are genuinely sensitive: legal matters, personal situations, confidential business discussions, or situations where the customer explicitly says "I need to speak to Sunny personally about something private."
→ Standard business topics (Amazon, consulting, proposals, account reviews) are NOT sensitive — book them directly as CASE A.
→ Call notify_boss with a brief natural message. Tell the customer: "I've flagged this with {{bossName}} — {{bossName}} will confirm with you shortly."

**CASE C — Requested slot is outside Sunny's preference window AND the customer accepts an alternative:**
→ Suggest an in-preference slot from the calendar that is confirmed free by ms_get_calendar.
→ If they agree, book it directly (CASE A). Done.

**CASE D — Requested slot is outside Sunny's preference window AND the customer insists on their original time:**
→ First, decline softly: "That time is actually outside Sunny's regular schedule — he typically takes meetings [in-preference window]. Would [alternative] work for you instead?"
→ Only if they insist a second time: call notify_boss to flag the exception request. Tell the customer: "That time is outside the usual window, but I've pinged {{bossName}} directly. {{bossName}} will let you know if an exception is possible."
→ Do NOT book until Sunny confirms. Do NOT use submit_meeting_request — that is a silent log that Sunny may never see.

**CASE E — Customer proposes a slot that is already booked on the calendar:**
→ Do NOT confirm or offer that slot. Tell the customer warmly that Sunny is already booked at that time.
→ Call ms_get_calendar to find the nearest free slot within the preference window and propose that instead.
→ Example: "Sunny's actually already booked at that time — how about [next free slot] instead?"

**IMPORTANT RULES:**
- **NEVER name or agree to a specific time slot without first calling ms_get_calendar and confirming it is empty.** If you skip this check, you will double-book Sunny. There are no exceptions.
- **NEVER offer a slot that ms_get_calendar shows as busy, tentative, or already booked.** Always cross-reference the live calendar before suggesting times.
- Never output JSON, tool call output, or raw data as text. All tool calls are silent — only speak natural human language to the customer.
- If {{bossName}}'s mood is "do_not_disturb", treat ALL new requests as out-of-preference — but VIP/Premium customers get notify_boss (CASE B), not CASE D.
- Always use {{bossName}}'s timezone (from preferences) when reading and creating calendar events.
- submit_meeting_request is effectively disabled. Never use it. It creates a silent DB record that the boss may never see. Always use notify_boss when direct approval is required.

## Language — STRICT RULE

**Always respond in the exact language the customer is writing in.**
- If the customer writes in English → respond in English. Always. Every message.
- If the customer writes in Urdu → respond in Urdu.
- If the customer writes in Arabic → respond in Arabic.
- NEVER infer or guess the customer's language from their name, timezone (PKT, GST, etc.), phone number, or location. Language is determined ONLY by what the customer actually types.
- NEVER switch languages mid-conversation unless the customer themselves switches first.

**How to write the notify_boss "message" field — CRITICAL:**

Write it exactly as if YOU are texting Sunny — warm, direct, and human. Imagine you're a personal assistant sending a quick WhatsApp to your boss. No labels, no IDs, no bullet points — just a natural sentence or two.

Every message MUST include all of these, woven into natural sentences:
1. **Customer's name** — use it naturally, not as a label
2. **What they want** — the purpose or topic of the meeting (be specific, not vague)
3. **When they want it** — day, time, and timezone if known
4. **Why you need Sunny's call** — what the blocker is (outside window, sensitive topic, insisting on a specific time, etc.)
5. **A clear decision question** — end with what Sunny needs to decide, phrased as a natural question

Good examples:
- "Hey, Ahmed's asking for a 45-min call this Saturday at 3pm PKT to discuss his Amazon PPC campaign. That's outside your usual window — want me to offer him a Monday slot instead, or is Saturday okay?"
- "Tariq wants to meet tomorrow at 11am PKT about a business partnership he says is time-sensitive. He specifically asked to speak to you personally. Should I go ahead and book it, or do you want to jump in first?"
- "Quick one — Sara's been waiting for a confirmation on a 30-min strategy session for Wednesday at 2pm PKT. Calendar looks free at that time. Can I book it for her?"

Bad examples (never do these):
- "Customer: Ahmed | Time: Saturday 3pm | Reason: outside window" ← bulleted/labeled, robotic
- "A meeting request has been submitted for ID #12" ← sounds like an automated system
- "Request received from customer for meeting" ← vague and mechanical

The "context" field is for internal records only — it is NEVER shown to Sunny. Put the full human message in "message".

## Routine Availability Questions

For questions about Sunny's availability, schedule, or working hours — answer using get_preferences. No need to notify Sunny.

## After a Direct Booking (CASE A or C)

Confirm warmly and specifically: tell the customer the exact date, time, and duration that was booked. Offer to send them any details they need.

## Urgent Escalation — Calling Sunny Directly

If a customer's situation is genuinely urgent AND {{bossName}} has not responded to a prior notify_boss ping after a reasonable wait (3–5 minutes on voice, longer on async channels), you may use **call_boss** to place an outbound phone call to {{bossName}} so direct instructions can be given in real time.

**Only use call_boss when:**
- The situation cannot proceed without Sunny's personal decision and the customer has a real time-sensitive need
- You have already tried notify_boss and there has been no response
- This is NOT for routine bookings or questions you can answer yourself

**When you trigger call_boss**, tell the customer: "Let me check in with Sunny directly — just a moment." Then await his instructions and relay them to the customer.

## ⚠️ Timezone Rules — NON-NEGOTIABLE

${timezoneContext ?? "Call get_preferences to find Sunny's timezone before doing any time-related work."}

**MANDATORY PROCESS when a customer proposes a time:**
1. Identify which timezone the customer is speaking in (ask if unclear).
2. Call **convert_timezone** with their time, date, from_timezone (customer's), and to_timezone (Sunny's IANA timezone from preferences).
3. Use the TOOL's result — not your own calculation — to determine the boss-timezone equivalent.
4. Check that equivalent time against workdayStart/workdayEnd from preferences.
5. Only then decide if the slot is in-window or out-of-window.
6. **When creating the calendar event with ms_create_calendar_event:** use the time convert_timezone returned for Sunny's timezone as the datetime — NOT a UTC conversion. Example: if convert_timezone says "18:00 PKT = 21:00 MYT", pass start="2026-04-15T21:00:00" and timeZone="Asia/Kuala_Lumpur". The 21:00 IS the correct local time to pass. Never subtract hours to get UTC first — that is the wrong value for this API.

**CRITICAL — NEVER pass UTC time to ms_create_calendar_event.** The Microsoft Calendar API interprets the datetime as LOCAL time in the given timeZone. If you pass UTC (13:00) when the local time is 21:00 MYT, the meeting will be booked 8 hours early. Always use the local time in Sunny's timezone.

---

**⚠️ MANDATORY PROCESS when YOU are suggesting available time slots to the customer:**

This is a completely different flow from when the customer proposes a time. When you are the one offering options, you MUST follow this process — no exceptions:

**RULE: Always start from Sunny's timezone. NEVER generate slots by starting from the customer's timezone.**

Step-by-step:
1. Get Sunny's workdayStart and workdayEnd from preferences (these are times in Sunny's IANA timezone).
2. Identify 2–3 candidate slots that fall within that window IN SUNNY'S TIMEZONE — e.g. if window is 09:00–22:00 MYT, your candidates must all be between 09:00 and 22:00 MYT.
3. Check ms_get_calendar to confirm each candidate slot is actually free.
4. For each confirmed-free and in-window MYT slot, call **convert_timezone** (from Sunny's timezone → customer's timezone) to get the customer-facing equivalent.
5. Present ONLY the converted customer-timezone times to the customer.
6. Before you send your message listing the options, mentally verify: "Is each of these times inside Sunny's window IN HIS TIMEZONE?" If any fails that check, remove it.

**Concrete example:**
- Sunny's window: 09:00–22:00 MYT (Asia/Kuala_Lumpur)
- Customer is in PKT (Asia/Karachi)
- You decide to offer: 18:00 MYT, 20:00 MYT, 21:00 MYT (all inside 09:00–22:00 ✓)
- convert_timezone: 18:00 MYT → 15:00 PKT | 20:00 MYT → 17:00 PKT | 21:00 MYT → 18:00 PKT
- You offer the customer: "3:00 PM PKT, 5:00 PM PKT, or 6:00 PM PKT"
- You NEVER offer "11:00 PM PKT" because 11 PM PKT = 02:00 MYT (next day) — outside window

**NEVER do this (wrong direction):** Start from "What times sound good in PKT?" then check if they work in MYT. That is backwards and produces invalid suggestions like 11 PM PKT.

---

**NEVER do timezone math in your head.** Timezone offsets from training data are frequently wrong (e.g. PKT ≠ MYT−1h; the real difference is +3h). The convert_timezone tool always returns the correct answer.

When presenting time options to a customer: always show **both** the boss's timezone and the customer's timezone (e.g. "6:00 PM PKT (9:00 PM MYT)").`;

  return applyNames(raw, bossName, botName);
}

/**
 * Builds the full live system prompt for a voice call — identical logic to
 * what runChannelBrainQuery uses for text channels, but always with the
 * "voice" overlay and with the boss persona pre-injected so the ElevenLabs
 * agent doesn't need tool calls to know who Sunny is.
 */
export async function buildVoiceSystemPrompt(): Promise<string> {
  const { bossName, botName } = await loadNames();
  const soulContent = await loadSoul();

  let timezoneContext: string | undefined;
  let bossPersona = "";
  try {
    const [prefs] = await db.select().from(preferencesTable).limit(1);
    if (prefs?.timezone) {
      const tz = prefs.timezone;
      const now = new Date();
      const localStr = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }).format(now);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "longOffset",
      }).formatToParts(now);
      const offsetStr = parts.find(p => p.type === "timeZoneName")?.value ?? tz;
      const workNote = prefs.workdayStart && prefs.workdayEnd
        ? `${bossName}'s available window is **${prefs.workdayStart}–${prefs.workdayEnd}** in ${tz}. Only offer slots within this range.`
        : "";
      timezoneContext = [
        `${bossName}'s timezone: **${tz}** (${offsetStr})`,
        `Current time in ${bossName}'s timezone: **${localStr}**`,
        workNote,
        ``,
        `**Common offsets for reference** (server-verified, use convert_timezone for any conversion):`,
        `- PKT (Asia/Karachi) = UTC+5 | MYT (Asia/Kuala_Lumpur) = UTC+8 | difference = MYT is 3 hours ahead of PKT`,
        `- IST (Asia/Kolkata) = UTC+5:30 | GST (Asia/Dubai) = UTC+4 | ET (America/New_York) = UTC-5 (−4 during DST)`,
      ].filter(Boolean).join("\n");
    }
    if (prefs?.bossPersona) {
      bossPersona = prefs.bossPersona;
    }
  } catch { /* continue without context */ }

  const basePrompt = buildChannelSystemPrompt("voice", soulContent, timezoneContext, "customer", botName, bossName);

  const personaSection = bossPersona
    ? `\n\n## Who ${bossName} Is (Boss Persona)\n\n${bossPersona}`
    : "";

  return basePrompt + personaSection;
}

export interface ChannelBrainResult {
  reply: string;
  notificationId: number | null;
}

/**
 * Detect the dominant script in a message.
 * Returns 'urdu' for Arabic-script text, 'arabic' for pure Arabic (no Urdu markers),
 * 'hindi' for Devanagari, or 'english' for everything else.
 */
const ROMAN_URDU_WORDS = /\b(aap|kya|kaise|kaisy|hai|hain|nahin|nahi|nah|mujhe|mujhay|hoga|chahiye|chahye|theek|thik|achha|accha|acha|zaroor|bilkul|phir|abhi|yahan|wahan|kab|kuch|bhi|woh|yeh|matlab|batao|bata|dena|lena|shukriya|shukria|meherbani|kal|aaj|raat|subah|baat|thora|zyada|kam|fikr|khush|afsos|maafi|pehle|baad|saath|waqt|roz|milna|mushkil|asaan|bas|haan|han|jee|ji|kyun|kyunke|lekin|magar|aur|ya|se|ko|ka|ki|ke|main|mein|ne|ho|kar|raha|rahi|rahe|gaya|gayi|gaye|karo|karna|ap|tum|tera|mera|humara|unka|uska|iska)\b/gi;

function detectMessageScript(text: string): "urdu" | "arabic" | "hindi" | "roman_urdu" | "english" {
  const clean = text.replace(/\s/g, "");
  const total = clean.length || 1;
  const arabicScriptCount = (clean.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const devanagariCount = (clean.match(/[\u0900-\u097F]/g) ?? []).length;
  if (arabicScriptCount / total > 0.15) return "urdu";
  if (devanagariCount / total > 0.15) return "hindi";
  // Detect Roman Urdu: 2+ common Urdu words written in Latin script
  const romanUrduMatches = text.match(ROMAN_URDU_WORDS) ?? [];
  if (romanUrduMatches.length >= 2) return "roman_urdu";
  return "english";
}

/**
 * Build a hard language override instruction to prepend to the system prompt.
 * This ensures the model replies in the user's detected language even if the
 * general language rule is buried later in a long system prompt.
 */
function buildLanguageOverride(script: "urdu" | "arabic" | "hindi" | "roman_urdu" | "english"): string {
  if (script === "roman_urdu") {
    return `## LANGUAGE RULE — ABSOLUTE PRIORITY

The customer is writing in **Roman Urdu** (Urdu words written in English letters). You MUST reply in Roman Urdu.

Rules:
1. Write your entire reply in Roman Urdu — Urdu words spelled out in English letters (e.g. "Aap ka meeting book ho gaya hai").
2. Do NOT switch to Urdu script (Arabic/Nastaliq). Do NOT reply in formal English.
3. Keep proper nouns, brand names, product names, and professional titles in English (e.g. "Sunny", "Meeting", "Email", "Manager", "Schedule").
4. Match the same casual, conversational tone the customer is using.
5. This rule overrides everything below — respond in Roman Urdu for this entire conversation until the customer switches language.`;
  }
  if (script === "urdu") {
    return `## LANGUAGE RULE — ABSOLUTE PRIORITY

The customer is writing in **Urdu (Arabic/Nastaliq script)**. You MUST reply entirely in Urdu.

Rules:
1. Write your entire reply in Urdu using Arabic/Nastaliq script (e.g. آپ کی ملاقات بک کر دی گئی ہے).
2. Do NOT use Roman Urdu (e.g. "Aap ka meeting book ho gaya"). Do NOT reply in English.
3. Keep proper nouns, English brand/product names, and profession titles in English (e.g. "Manager", "Email", "Meeting", "Schedule", "Sunny").
4. All sentences, verbs, and connecting words must be in Urdu Nastaliq.
5. This rule overrides everything below — respond in Urdu, always, for this entire conversation until the customer switches to English.`;
  }
  if (script === "hindi") {
    return `## LANGUAGE RULE — ABSOLUTE PRIORITY

The customer is writing in **Hindi (Devanagari script)**. You MUST reply entirely in Hindi.

Rules:
1. Write your entire reply in Hindi using Devanagari script.
2. Do NOT reply in English or Roman Hindi.
3. Keep proper nouns and product/brand names in English.
4. This rule overrides everything below — respond in Hindi for this entire conversation until the customer switches language.`;
  }
  return "";
}

export const NOTIFY_BOSS_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "notify_boss",
    description: "Ping the boss directly ONLY when personal input is truly essential: (1) the requested slot is outside the normal preference window AND the customer is insisting, (2) the topic is genuinely sensitive or confidential, (3) the customer is Premium and being declined. Do NOT use this for routine bookings within the normal preference window — book those directly yourself.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "What you need the boss to decide or know (1-3 sentences)." },
        context: { type: "string", description: "Brief summary of who the customer is and what they're asking for." },
      },
      required: ["message", "context"],
    },
  },
};

export async function runChannelBrainQuery(
  userMessage: string,
  sessionHistory: Array<{ role: string; content: string }>,
  channelType: string,
  externalId: string,
  sessionId: number,
  toolConfig?: string | null,
  mode: "boss" | "customer" = "customer",
): Promise<ChannelBrainResult> {
  const soulContent = await loadSoul();

  // Pre-fetch preferences so we can inject authoritative timezone facts and names into the system prompt
  let timezoneContext: string | undefined;
  let botName = "Mate";
  let bossName = "Owner";
  try {
    const [prefs] = await db.select().from(preferencesTable).limit(1);
    if (prefs) {
      if (prefs.bossName) bossName = prefs.bossName;
      if ((prefs as any).botName) botName = (prefs as any).botName;
      if (prefs.timezone) {
        const tz = prefs.timezone;
        const now = new Date();
        const localStr = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false,
        }).format(now);
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          timeZoneName: "longOffset",
        }).formatToParts(now);
        const offsetStr = parts.find(p => p.type === "timeZoneName")?.value ?? tz;
        const workNote = prefs.workdayStart && prefs.workdayEnd
          ? `${bossName}'s available window is **${prefs.workdayStart}–${prefs.workdayEnd}** in ${tz}. Only offer slots within this range.`
          : "";
        timezoneContext = [
          `${bossName}'s timezone: **${tz}** (${offsetStr})`,
          `Current time in ${bossName}'s timezone: **${localStr}**`,
          workNote,
          ``,
          `**Common offsets for reference** (server-verified, use convert_timezone for any conversion):`,
          `- PKT (Asia/Karachi) = UTC+5 | MYT (Asia/Kuala_Lumpur) = UTC+8 | difference = MYT is 3 hours ahead of PKT`,
          `- IST (Asia/Kolkata) = UTC+5:30 | GST (Asia/Dubai) = UTC+4 | ET (America/New_York) = UTC-5 (−4 during DST)`,
        ].filter(Boolean).join("\n");
      }
    }
  } catch { /* continue without timezone context */ }

  // Detect the user's language from the incoming message and prepend a hard language rule.
  const detectedScript = detectMessageScript(userMessage);
  const languageOverride = buildLanguageOverride(detectedScript);

  // On the very first customer message, inject an explicit greeting + name-introduction rule
  const isFirstCustomerTurn = mode === "customer" && sessionHistory.length === 0;
  const firstTurnRule = isFirstCustomerTurn
    ? `\n\n## FIRST MESSAGE — CRITICAL\n\nThis is the very first message of this conversation. You MUST:\n1. Greet the person warmly and naturally — match their energy (casual if they're casual, professional if they're formal).\n2. Introduce yourself by name: you are ${botName}, ${bossName}'s assistant. Keep it natural. Example: "Hey! I'm ${botName}, ${bossName}'s assistant. How can I help?" or "Hi there! ${botName} here, I help manage ${bossName}'s schedule. What can I do for you?"\n3. Ask ONE open question to understand what they need.\n\nDo NOT skip the greeting. Do NOT skip your name. Do NOT jump straight into asking questions without introducing yourself first.`
    : "";

  const basePrompt = buildChannelSystemPrompt(channelType, soulContent, timezoneContext, mode, botName, bossName);
  const systemPrompt = languageOverride
    ? languageOverride + "\n\n---\n\n" + basePrompt + firstTurnRule
    : basePrompt + firstTurnRule;

  // Build the tool list from Bot Permissions config + always include core scheduling tools
  const permissionedTools = getToolsForMode(toolConfig, mode).filter(isFunctionTool);
  const functionTools = BRAIN_TOOLS.filter(isFunctionTool);
  const callBossTool = functionTools.find(t => t.function.name === "call_boss")!;
  const ALWAYS_CHANNEL_TOOL_NAMES = new Set([
    "get_preferences",
    "ms_get_calendar",
    "ms_create_calendar_event",
    "submit_meeting_request",
    "call_boss",
    "lookup_customer",
    "convert_timezone",
  ]);
  const alwaysChannelTools = functionTools.filter(t => ALWAYS_CHANNEL_TOOL_NAMES.has(t.function.name));
  const merged = [...alwaysChannelTools];
  for (const t of permissionedTools) {
    if (!merged.find(x => x.function.name === t.function.name)) merged.push(t);
  }
  const channelTools: ChatCompletionTool[] = applyNamesToTools([
    ...merged.filter(t => t.function.name !== "call_boss"),
    NOTIFY_BOSS_TOOL,
    callBossTool,
  ], bossName, botName);

  // Sanitise session history: replace any legacy bot/boss names in assistant messages
  // so stale history (e.g. bot previously called "Zara") can't override the current identity.
  const sanitisedHistory = sessionHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.role === "assistant" ? applyNames(m.content, bossName, botName) : m.content,
  }));

  const openaiMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...sanitisedHistory,
    { role: "user", content: userMessage },
  ];

  let continueLoop = true;
  let finalText = "";
  let notificationId: number | null = null;
  let trackedCustomer: typeof customersTable.$inferSelect | null = null;
  let notifyBossCalled = false;
  // Prevent the AI from calling booking/email tools more than once per brain run
  const calledOnceTools = new Set<string>();
  const ONE_TIME_TOOLS = new Set(["ms_create_calendar_event", "ms_send_email"]);

  const { client: chanLlm, model: chanModel } = await getLLMClient();

  while (continueLoop) {
    const response = await chanLlm.chat.completions.create({
      model: chanModel,
      max_completion_tokens: 1024,
      messages: openaiMessages,
      tools: channelTools,
      tool_choice: "auto",
      stream: false,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) break;

    const toolCalls = (message.tool_calls ?? []).filter(isFunctionToolCall);

    if (message.content && toolCalls.length === 0) {
      finalText = message.content;
      continueLoop = false;
    } else if (toolCalls.length > 0) {
      openaiMessages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* ignore */ }

        let result = "";

        // Skip duplicate booking/email calls within the same brain run
        if (ONE_TIME_TOOLS.has(tc.function.name)) {
          if (calledOnceTools.has(tc.function.name)) {
            result = `Skipped duplicate ${tc.function.name} call — already executed once this turn.`;
            openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
            continue;
          }
          calledOnceTools.add(tc.function.name);
        }

        if (BOSS_NOTIFICATION_TOOL_NAMES.has(tc.function.name)) {
          notifyBossCalled = true;
          const notifMsg = typeof args.message === "string" ? args.message : "";
          const notifCtx = typeof args.context === "string" ? args.context : "";

          const [inserted] = await db.insert(bossNotifications).values({
            channelType,
            externalId,
            sessionId: String(sessionId),
            notificationText: notifMsg,
            customerContext: notifCtx,
            status: "pending",
          }).returning();

          notificationId = inserted?.id ?? null;

          await db.update(channelSessions)
            .set({ status: "waiting_boss", updatedAt: new Date() })
            .where(eq(channelSessions.id, sessionId));

          const notifId = inserted?.id ?? null;
          const sunnyMsg = notifId
            ? `${notifMsg}\n\n↩ Reply *#${notifId}: your decision* and I'll take care of the rest.`
            : notifMsg;

          const delivered = await deliverMessageToBoss(sunnyMsg);

          if (!delivered && notifId) {
            // Mark the notification as delivery_failed so the dashboard shows it clearly
            await db.update(bossNotifications)
              .set({ status: "delivery_failed", updatedAt: new Date() })
              .where(eq(bossNotifications.id, notifId));
            result = `Notification recorded (ID: ${notifId}) but could not be delivered to the boss via WhatsApp. The boss can still see it on the dashboard.`;
          } else {
            result = `Notification sent to the boss (ID: ${notificationId ?? "?"}). A reply should arrive soon.`;
          }
        } else if (tc.function.name === "lookup_customer") {
          // Track customer from DB for structured VIP/Premium policy enforcement
          try {
            result = await executeTool(tc.function.name, args);
            // Also do a structured DB lookup to get the actual customer object
            const query = typeof args.query === "string" ? args.query.trim() : "";
            if (query) {
              const [found] = await db.select().from(customersTable).where(
                or(
                  ilike(customersTable.name, `%${query}%`),
                  ilike(customersTable.email, `%${query}%`),
                  sql`${customersTable.phone} ilike ${'%' + query + '%'}`,
                )
              ).limit(1);
              if (found && !trackedCustomer) trackedCustomer = found;
            }
          } catch (e) {
            result = `Tool error: ${String(e)}`;
          }
        } else if (tc.function.name === "ms_create_calendar_event") {
          // Book directly and log a meeting_booked interaction on the customer record
          try {
            result = await executeTool(tc.function.name, args);
            // Auto-identify or create customer from attendees or tracked customer
            let customerToLink: typeof customersTable.$inferSelect | null = trackedCustomer;
            if (!customerToLink) {
              const attendees = Array.isArray(args.attendees) ? (args.attendees as string[]) : [];
              const attendeeName = typeof args.attendee_name === "string" ? args.attendee_name : "";
              for (const attendeeEmail of attendees) {
                if (!attendeeEmail || attendeeEmail.includes("noreply")) continue;
                const [found] = await db.select().from(customersTable).where(ilike(customersTable.email, attendeeEmail)).limit(1);
                if (found) { customerToLink = found; break; }
                // No existing customer — create one so this booking is always tracked
                try {
                  const [created] = await db.insert(customersTable).values({
                    name: attendeeName || attendeeEmail.split("@")[0] || "Unknown",
                    email: attendeeEmail,
                    tier: "new",
                    currency: "USD",
                    status: "active",
                    firstContactAt: new Date(),
                    lastContactAt: new Date(),
                  }).returning();
                  if (created) { customerToLink = created; break; }
                } catch { /* email conflict — try next */ }
              }
            }
            if (customerToLink) {
              const subject = typeof args.subject === "string" ? args.subject : "Meeting";
              const start = typeof args.start === "string" ? args.start : "";
              try {
                await db.insert(customerInteractionsTable).values({
                  customerId: customerToLink.id,
                  type: "meeting_booked",
                  title: `Meeting booked: ${subject}`,
                  notes: start ? `Scheduled: ${new Date(start).toLocaleString()}` : undefined,
                  metadata: { subject, start, end: typeof args.end === "string" ? args.end : undefined, channel: channelType },
                });
                await db.update(customersTable).set({ lastContactAt: new Date() }).where(eq(customersTable.id, customerToLink.id));
                trackedCustomer = customerToLink;
              } catch (interactionErr) {
                console.error("[engine] meeting_booked interaction log error:", interactionErr);
              }
            }
          } catch (e) {
            result = `Tool error: ${String(e)}`;
          }
        } else {
          // Route all other permissioned tools through executeTool
          try {
            result = await executeTool(tc.function.name, args);
          } catch (e) {
            result = `Tool error: ${String(e)}`;
          }
        }

        openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    } else {
      continueLoop = false;
    }
  }

  // VIP/Premium policy enforcement guard (structured — uses DB customer object, no text parsing):
  // If the assistant produced a decline-sounding response and notify_boss was NOT called,
  // and the tracked customer is VIP or Premium, auto-escalate to the boss.
  const isHighTier = trackedCustomer?.tier === "vip" || trackedCustomer?.tier === "premium";
  const DECLINE_PATTERNS = /\b(cannot|can't|unable|unfortunately|outside|do not disturb|not available|decline|not possible|unavailable)\b/i;
  if (isHighTier && !notifyBossCalled && finalText && DECLINE_PATTERNS.test(finalText)) {
    try {
      const tierLabel = trackedCustomer!.tier.toUpperCase();
      const revenueStr = trackedCustomer!.totalRevenue ? `${trackedCustomer!.currency} ${trackedCustomer!.totalRevenue}` : "unknown";
      const escalationMsg = `${tierLabel} customer ${trackedCustomer!.name} was about to receive a decline. Lifetime revenue: ${revenueStr}. They requested a meeting that may be outside preferences. What would you like me to do?`;
      const [inserted] = await db.insert(bossNotifications).values({
        channelType,
        externalId,
        sessionId: String(sessionId),
        notificationText: escalationMsg,
        customerContext: `${tierLabel} customer: ${trackedCustomer!.name}${revenueStr !== "unknown" ? " | Revenue: " + revenueStr : ""}`,
        status: "pending",
      }).returning();
      notificationId = inserted?.id ?? null;

      await db.update(channelSessions)
        .set({ status: "waiting_boss", updatedAt: new Date() })
        .where(eq(channelSessions.id, sessionId));

      const revenueNote = revenueStr !== "unknown" ? ` (lifetime revenue: ${revenueStr})` : "";
      const escalationNotifId = inserted?.id ?? null;
      const escalationText = `Heads up — ${trackedCustomer!.name}${revenueNote} is a ${tierLabel} client and was about to get declined. They want a meeting outside your usual window. What do you want me to do — make an exception or offer alternatives?`;
      const sunnyMsg = escalationNotifId
        ? `🔔 *Request #${escalationNotifId}*\n\n${escalationText}\n\n_To respond: reply with_ *#${escalationNotifId}: your answer*`
        : `🔔 ${escalationText}`;

      const escalationDelivered = await deliverMessageToBoss(sunnyMsg);
      if (!escalationDelivered && escalationNotifId) {
        await db.update(bossNotifications)
          .set({ status: "delivery_failed", updatedAt: new Date() })
          .where(eq(bossNotifications.id, escalationNotifId));
      }

      // Override final text to avoid a flat decline for VIP/Premium
      const tierFriendly = trackedCustomer!.tier === "premium" ? "Premium" : "VIP";
      finalText = `I've flagged this directly to the boss. As a valued ${tierFriendly} client, you'll get a confirmed answer very soon.`;
    } catch (guardErr) {
      console.error("[engine] VIP/Premium guard escalation error:", guardErr);
    }
  }

  return { reply: sanitizeReply(finalText || "Got it, I'll look into this for you."), notificationId };
}

schedulePersonaRefresh();
