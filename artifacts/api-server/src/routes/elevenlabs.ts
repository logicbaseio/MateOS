import { Router, type IRouter } from "express";
import { db, preferencesTable } from "@workspace/db";
import { buildVoiceSystemPrompt } from "../brain/engine";

const router: IRouter = Router();

/**
 * POST /api/elevenlabs/outbound-call
 *
 * Uses ElevenLabs' own managed calling infrastructure.
 * ElevenLabs uses their own phone numbers (configured via phone_number_id in DB),
 * which have proper routing to UK/EU numbers — avoiding US-carrier blocking issues.
 *
 * ElevenLabs docs: POST /v1/convai/twilio/outbound-call
 */
router.post("/elevenlabs/outbound-call", async (req, res): Promise<void> => {
  const { to_number, first_message } = req.body as { to_number?: string; first_message?: string };

  if (!to_number) {
    res.status(400).json({ error: "to_number is required" });
    return;
  }

  const [prefs] = await db.select().from(preferencesTable).limit(1);
  const apiKey = prefs?.elevenLabsApiKey?.trim() || process.env.ElevenLabs_API_Key?.trim();
  const agentId = prefs?.elevenLabsAgentId?.trim() || process.env.ElevenLabs_Agent_ID?.trim();
  const phoneNumberId = prefs?.elevenLabsPhoneNumberId?.trim();

  if (!apiKey || !agentId) {
    res.status(400).json({
      error: "ElevenLabs not fully configured. Check API Key and Agent ID in Bot Permissions.",
    });
    return;
  }

  if (!phoneNumberId) {
    res.status(400).json({
      error: "ElevenLabs Phone Number ID is required for outbound calls. Add it in Bot Permissions.",
    });
    return;
  }

  const [prefRow] = await db.select().from(preferencesTable).limit(1);
  const botName = (prefRow as any)?.botName ?? "Mate";
  const bossName = prefRow?.bossName ?? "Owner";

  const resolvedFirstMessage =
    (first_message?.trim()) ||
    `Hi, this is ${botName} calling on behalf of ${bossName}. Is now a good time to chat?`;

  // Build the live system prompt so the outbound call gets the assistant's full context
  // (soul, boss persona, preferences, timezone) — without this, the agent falls back
  // to whatever static prompt is in ElevenLabs, which often causes an instant hang-up.
  let liveSystemPrompt: string | undefined;
  try {
    liveSystemPrompt = await buildVoiceSystemPrompt();
    console.log("[ElevenLabs] Live system prompt built, length:", liveSystemPrompt.length);
  } catch (err) {
    console.warn("[ElevenLabs] Could not build live system prompt, proceeding without override:", err);
  }

  console.log("[ElevenLabs] Initiating outbound call to", to_number, "via ElevenLabs managed calling");

  try {
    const agentOverride: Record<string, unknown> = { first_message: resolvedFirstMessage };
    if (liveSystemPrompt) {
      agentOverride.prompt = { prompt: liveSystemPrompt };
    }

    const body = {
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number,
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: agentOverride,
        },
      },
    };

    console.log("[ElevenLabs] outbound-call payload:", JSON.stringify(body));

    const elResp = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const responseText = await elResp.text();
    console.log("[ElevenLabs] outbound-call status:", elResp.status, "response:", responseText.substring(0, 300));

    if (!elResp.ok) {
      res.status(500).json({ error: "ElevenLabs outbound call failed", detail: responseText });
      return;
    }

    let responseData: Record<string, unknown> = {};
    try { responseData = JSON.parse(responseText) as Record<string, unknown>; } catch { /* plain text */ }

    res.json({ success: true, ...responseData });
  } catch (err) {
    console.error("[ElevenLabs] outbound-call exception:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/elevenlabs/inbound-hook
 *
 * Webhook that ElevenLabs calls at the very start of every INBOUND call.
 * Returns a conversation_config_override with the live system prompt.
 * Configure in ElevenLabs agent → Advanced → Webhook URL:
 *   https://mateos.example.com/api/elevenlabs/inbound-hook
 */
router.post("/elevenlabs/inbound-hook", async (_req, res): Promise<void> => {
  try {
    const systemPrompt = await buildVoiceSystemPrompt();
    res.json({
      conversation_config_override: {
        agent: {
          prompt: { prompt: systemPrompt },
        },
      },
    });
  } catch (err) {
    console.error("[ElevenLabs inbound-hook] Failed to build system prompt:", err);
    res.json({});
  }
});

/**
 * POST /api/elevenlabs/sync
 * Manually push the live system prompt to the ElevenLabs agent right now.
 */
router.post("/elevenlabs/sync", async (_req, res): Promise<void> => {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  const apiKey = prefs?.elevenLabsApiKey?.trim();
  const agentId = prefs?.elevenLabsAgentId?.trim();

  if (!apiKey || !agentId) {
    res.status(400).json({ error: "ElevenLabs API Key and Agent ID required." });
    return;
  }

  try {
    const systemPrompt = await buildVoiceSystemPrompt();

    const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: { prompt: systemPrompt },
          },
          asr: {
            language: null,
          },
          tts: {
            model_id: "eleven_turbo_v2_5",
          },
        },
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      res.status(response.status).json({ error: `ElevenLabs API error: ${responseText}` });
      return;
    }

    res.json({ success: true, promptLength: systemPrompt.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/elevenlabs/diagnose
 * Runs a diagnostic: checks ElevenLabs agent config, validates Twilio credentials,
 * and fetches recent failed Twilio calls to surface error codes.
 */
router.get("/elevenlabs/diagnose", async (_req, res): Promise<void> => {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  const apiKey = prefs?.elevenLabsApiKey?.trim();
  const agentId = prefs?.elevenLabsAgentId?.trim();
  const phoneNumberId = prefs?.elevenLabsPhoneNumberId?.trim();

  const report: Record<string, unknown> = {
    configured: { apiKey: !!apiKey, agentId: !!agentId, phoneNumberId: !!phoneNumberId },
  };

  // 1. Check ElevenLabs agent config
  if (apiKey && agentId) {
    try {
      const agentResp = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        headers: { "xi-api-key": apiKey },
      });
      const agentText = await agentResp.text();
      if (agentResp.ok) {
        const agentData = JSON.parse(agentText) as Record<string, unknown>;
        const convConfig = agentData.conversation_config as Record<string, unknown> | undefined;
        const agentSection = convConfig?.agent as Record<string, unknown> | undefined;
        const prompt = agentSection?.prompt as Record<string, unknown> | undefined;
        report.elevenLabsAgent = {
          status: "ok",
          name: agentData.name,
          promptLength: (prompt?.prompt as string | undefined)?.length ?? 0,
        };
      } else {
        report.elevenLabsAgent = { status: "error", code: agentResp.status, body: agentText };
      }
    } catch (e) {
      report.elevenLabsAgent = { status: "exception", error: String(e) };
    }
  }

  // 2. Check Twilio credentials and geo-permissions
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;

  if (twilioSid && twilioToken) {
    const authHeader = "Basic " + Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");

    // Account info
    try {
      const accResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}.json`, {
        headers: { Authorization: authHeader },
      });
      const accData = await accResp.json() as Record<string, unknown>;
      report.twilioAccount = accResp.ok
        ? { status: "ok", friendlyName: accData.friendly_name, accountStatus: accData.status }
        : { status: "error", code: accResp.status, message: accData.message };
    } catch (e) {
      report.twilioAccount = { status: "exception", error: String(e) };
    }

    // Recent failed calls
    try {
      const callsResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json?Status=failed&PageSize=5`,
        { headers: { Authorization: authHeader } }
      );
      const callsData = await callsResp.json() as Record<string, unknown>;
      if (callsResp.ok && Array.isArray(callsData.calls)) {
        report.recentFailedCalls = (callsData.calls as Record<string, unknown>[]).map(c => ({
          sid: c.sid,
          from: c.from,
          to: c.to,
          status: c.status,
          errorCode: c.error_code,
          errorMessage: c.error_message,
          date: c.start_time,
        }));
      } else {
        report.recentFailedCalls = { error: callsData.message ?? "could not fetch" };
      }
    } catch (e) {
      report.recentFailedCalls = { exception: String(e) };
    }

    // UK Geo-permissions
    try {
      const geoResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/OutgoingCallerIds.json`,
        { headers: { Authorization: authHeader } }
      );
      report.twilioCallerIdsStatus = geoResp.status;
    } catch (e) {
      report.twilioGeo = { exception: String(e) };
    }
  } else {
    report.twilioAccount = { status: "missing", message: "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set in env" };
  }

  res.json(report);
});

/**
 * GET /api/elevenlabs/config
 */
router.get("/elevenlabs/config", async (_req, res): Promise<void> => {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  res.json({
    configured: !!(prefs?.elevenLabsApiKey && prefs?.elevenLabsAgentId && prefs?.elevenLabsPhoneNumberId),
    hasApiKey: !!prefs?.elevenLabsApiKey,
    hasAgentId: !!prefs?.elevenLabsAgentId,
    hasPhoneNumberId: !!prefs?.elevenLabsPhoneNumberId,
  });
});

export default router;
