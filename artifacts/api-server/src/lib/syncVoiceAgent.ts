/**
 * syncVoiceAgent.ts
 *
 * Pushes the live system prompt (soul + preferences + timezone + boss persona)
 * to the ElevenLabs agent via their PATCH API.  Call this fire-and-forget
 * after any mutation that affects what the assistant should know:
 *   - soul.md updated
 *   - preferences updated
 *   - boss persona refreshed (which happens after memory changes)
 *
 * This keeps the ElevenLabs agent's dashboard config in perfect sync so every
 * inbound and outbound call automatically uses the latest state — no webhook
 * configuration needed in the ElevenLabs dashboard.
 */

import { db, preferencesTable } from "@workspace/db";
import { buildVoiceSystemPrompt } from "../brain/engine";

export async function syncVoiceAgent(): Promise<void> {
  try {
    const [prefs] = await db.select().from(preferencesTable).limit(1);
    const apiKey = prefs?.elevenLabsApiKey?.trim();
    const agentId = prefs?.elevenLabsAgentId?.trim();

    if (!apiKey || !agentId) return; // not configured — skip silently

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
            prompt: {
              prompt: systemPrompt,
            },
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

    if (!response.ok) {
      const body = await response.text();
      console.warn(`[syncVoiceAgent] ElevenLabs PATCH failed (${response.status}):`, body);
    } else {
      console.log("[syncVoiceAgent] ElevenLabs agent synced ✓ (prompt + multilingual ASR/TTS)");
    }
  } catch (err) {
    console.warn("[syncVoiceAgent] Failed to sync ElevenLabs agent:", err);
  }
}
