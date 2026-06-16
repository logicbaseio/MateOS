/**
 * WhatsApp Voice Note Support
 *
 * Flow:
 *   Customer sends voice note
 *   → Download audio from WhatsApp Media API
 *   → Transcribe with OpenAI Whisper (via AI integrations proxy)
 *   → Run transcribed text through Zara (runChannelBrainQuery)
 *   → Convert Zara's reply to speech with ElevenLabs TTS
 *   → Upload audio to WhatsApp and send back as a voice note
 */

import { db, preferencesTable } from "@workspace/db";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Detect the dominant script in a string.
 * Returns 'urdu' for Arabic-script text (Urdu/Sindhi/Punjabi written in Nastaliq),
 * 'hindi' for Devanagari, or 'english' for everything else.
 */
const ROMAN_URDU_PATTERN = /\b(aap|kya|kaise|kaisy|hai|hain|nahin|nahi|nah|mujhe|mujhay|hoga|chahiye|chahye|theek|thik|achha|accha|acha|zaroor|bilkul|phir|abhi|yahan|wahan|kab|kuch|bhi|woh|yeh|matlab|batao|bata|dena|lena|shukriya|shukria|meherbani|kal|aaj|raat|subah|baat|thora|zyada|kam|fikr|khush|afsos|maafi|pehle|baad|saath|waqt|roz|milna|mushkil|asaan|bas|haan|han|jee|ji|kyun|kyunke|lekin|magar|aur|ya|se|ko|ka|ki|ke|main|mein|ne|ho|kar|raha|rahi|rahe|gaya|gayi|gaye|karo|karna|ap|tum|tera|mera|humara|unka|uska|iska)\b/gi;

export function detectScript(text: string): "urdu" | "hindi" | "roman_urdu" | "english" {
  const totalChars = text.replace(/\s/g, "").length || 1;
  const arabicScriptCount = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) ?? []).length;

  if (arabicScriptCount / totalChars > 0.15) return "urdu";
  if (devanagariCount / totalChars > 0.15) return "hindi";
  const romanUrduMatches = text.match(ROMAN_URDU_PATTERN) ?? [];
  if (romanUrduMatches.length >= 2) return "roman_urdu";
  return "english";
}

async function getPrefs() {
  const [prefs] = await db.select().from(preferencesTable).limit(1);
  return prefs ?? null;
}

/** Returns the custom voice note instructions if configured, otherwise empty string. */
export async function getVoiceNoteInstructions(): Promise<string> {
  const prefs = await getPrefs();
  return prefs?.voiceNoteInstructions?.trim() ?? "";
}

// Cache voice ID for 1 hour to avoid hitting ElevenLabs agent API on every voice note
let cachedVoiceId: string | null = null;
let cachedVoiceIdExpiry = 0;

async function getElevenLabsVoiceId(apiKey: string): Promise<string> {
  // Return cached value if still fresh
  if (cachedVoiceId && Date.now() < cachedVoiceIdExpiry) {
    console.log(`[voiceNote] Using cached voice ID: ${cachedVoiceId}`);
    return cachedVoiceId;
  }

  try {
    const prefs = await getPrefs();

    // If a dedicated voice note voice ID is configured, use it directly
    const directVoiceId = prefs?.voiceNoteVoiceId?.trim();
    if (directVoiceId) {
      console.log(`[voiceNote] Using configured voice note voice ID: ${directVoiceId}`);
      cachedVoiceId = directVoiceId;
      cachedVoiceIdExpiry = Date.now() + 60 * 60 * 1000;
      return directVoiceId;
    }

    // Check DB preferences first, then fall back to environment variable
    const agentId = prefs?.elevenLabsAgentId?.trim() || process.env.ElevenLabs_Agent_ID?.trim();
    if (agentId) {
      console.log(`[voiceNote] Fetching voice ID from agent ${agentId}`);
      const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        headers: { "xi-api-key": apiKey },
      });
      if (res.ok) {
        const data = await res.json() as { conversation_config?: { tts?: { voice_id?: string } } };
        const voiceId = data.conversation_config?.tts?.voice_id;
        if (voiceId) {
          console.log(`[voiceNote] Resolved agent voice ID: ${voiceId} (caching 1hr)`);
          cachedVoiceId = voiceId;
          cachedVoiceIdExpiry = Date.now() + 60 * 60 * 1000;
          return voiceId;
        }
        console.warn("[voiceNote] Agent config has no voice_id — using default");
      } else {
        const body = await res.text().catch(() => "");
        console.warn(`[voiceNote] Agent fetch failed (${res.status}): ${body} — using default voice`);
      }
    } else {
      console.warn("[voiceNote] No agent ID in settings or env — using default voice");
    }
  } catch (err) {
    console.warn("[voiceNote] getElevenLabsVoiceId error:", err);
  }

  // Use cached value (even if expired) rather than default, if we have one
  if (cachedVoiceId) {
    console.log(`[voiceNote] ElevenLabs API down — using stale cached voice ID: ${cachedVoiceId}`);
    return cachedVoiceId;
  }

  return "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs default: Rachel
}

/**
 * Download a WhatsApp media file by its media ID.
 * Returns the raw audio buffer and MIME type.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) throw new Error(`[voiceNote] Media metadata fetch failed: ${metaRes.status}`);
  const meta = await metaRes.json() as { url?: string; mime_type?: string };
  const url = meta.url;
  if (!url) throw new Error("[voiceNote] No download URL in media metadata");

  const mediaRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!mediaRes.ok) throw new Error(`[voiceNote] Media download failed: ${mediaRes.status}`);

  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const mimeType = meta.mime_type ?? mediaRes.headers.get("content-type") ?? "audio/ogg";
  return { buffer, mimeType };
}

/**
 * Transcribe audio using Groq Whisper (primary) or ElevenLabs Scribe (fallback).
 *
 * Groq provides free Whisper inference that works from any server/cloud environment.
 * ElevenLabs Scribe is blocked on free-tier accounts from data-center IPs (Replit servers).
 *
 * Priority:
 *   1. Groq Whisper — if GROQ_API_KEY env var is set
 *   2. ElevenLabs Scribe — if ElevenLabs API key is configured (requires paid plan)
 *
 * Supports all WhatsApp audio formats: ogg/opus, mp4, aac, amr, mpeg.
 */
export async function transcribeWithWhisper(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") ? "mp4"
    : mimeType.includes("aac") ? "aac"
    : mimeType.includes("amr") ? "amr"
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
    : "ogg";

  // --- Option 1: Groq Whisper (preferred — works from any server, generous free tier) ---
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    console.log("[voiceNote] STT: using Groq Whisper");
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-large-v3");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[voiceNote] Groq Whisper failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { text?: string };
    return (data.text ?? "").trim();
  }

  // --- Option 2: ElevenLabs Scribe (fallback — requires paid ElevenLabs account) ---
  const prefs = await getPrefs();
  const elKey = prefs?.elevenLabsApiKey?.trim() || process.env.ElevenLabs_API_Key?.trim();
  if (elKey) {
    console.log("[voiceNote] STT: using ElevenLabs Scribe");
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model_id", "scribe_v1");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": elKey },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[voiceNote] ElevenLabs STT failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { text?: string };
    return (data.text ?? "").trim();
  }

  throw new Error("[voiceNote] No transcription service configured — add GROQ_API_KEY to secrets");
}

// ─── Urdu Pronunciation Dictionary ───────────────────────────────────────────
// Cached dictionary ID and version ID — uploaded once, reused on every TTS call.
let cachedUrduDictId: string | null = null;
let cachedUrduDictVersionId: string | null = null;

const URDU_DICT_NAME = "MateOS Urdu Script";
const URDU_DICT_PATH = join(process.cwd(), "..", "..", "dictionaries", "urdu-script-pronunciation.pls");

/**
 * Upload the Urdu script PLS file to ElevenLabs (once) and return its locator.
 * On subsequent calls, returns the cached IDs without re-uploading.
 */
async function getUrduDictionaryLocator(
  apiKey: string,
): Promise<{ pronunciation_dictionary_id: string; version_id: string } | null> {
  if (cachedUrduDictId && cachedUrduDictVersionId) {
    return { pronunciation_dictionary_id: cachedUrduDictId, version_id: cachedUrduDictVersionId };
  }

  try {
    // Check if a dictionary with this name already exists
    const listRes = await fetch("https://api.elevenlabs.io/v1/pronunciation-dictionaries?page_size=50", {
      headers: { "xi-api-key": apiKey },
    });
    if (listRes.ok) {
      const listData = await listRes.json() as { pronunciation_dictionaries?: { id: string; name: string; latest_version_id: string }[] };
      const existing = listData.pronunciation_dictionaries?.find(d => d.name === URDU_DICT_NAME);
      if (existing) {
        cachedUrduDictId = existing.id;
        cachedUrduDictVersionId = existing.latest_version_id;
        console.log(`[voiceNote] Urdu dictionary found: id=${cachedUrduDictId} version=${cachedUrduDictVersionId}`);
        return { pronunciation_dictionary_id: cachedUrduDictId, version_id: cachedUrduDictVersionId };
      }
    }

    // Not found — upload the PLS file
    let plsContent: Buffer;
    try {
      plsContent = readFileSync(URDU_DICT_PATH);
    } catch {
      console.warn("[voiceNote] Urdu PLS file not found at:", URDU_DICT_PATH);
      return null;
    }

    const form = new FormData();
    form.append("name", URDU_DICT_NAME);
    form.append("description", "Pakistani Urdu script pronunciation dictionary with harakat diacritics");
    form.append("file", new Blob([new Uint8Array(plsContent)], { type: "application/pls+xml" }), "urdu-script-pronunciation.pls");

    const uploadRes = await fetch("https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => "");
      console.warn(`[voiceNote] Urdu dictionary upload failed (${uploadRes.status}): ${errBody}`);
      return null;
    }

    const uploadData = await uploadRes.json() as { id: string; version_id: string };
    cachedUrduDictId = uploadData.id;
    cachedUrduDictVersionId = uploadData.version_id;
    console.log(`[voiceNote] Urdu dictionary uploaded: id=${cachedUrduDictId} version=${cachedUrduDictVersionId}`);
    return { pronunciation_dictionary_id: cachedUrduDictId, version_id: cachedUrduDictVersionId };

  } catch (err) {
    console.warn("[voiceNote] Urdu dictionary lookup/upload error:", err);
    return null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert text to speech, returning an MP3 buffer.
 *
 * Priority:
 *   1. Groq TTS (PlayAI) — uses GROQ_API_KEY, works from any server, free tier available
 *   2. ElevenLabs TTS — uses DB preferences API key, requires paid plan
 *
 * Returns null if no TTS service is available — caller falls back to text reply.
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
  // --- Option 1: ElevenLabs TTS (preferred — Zara's exact voice, requires paid plan) ---
  try {
    const prefs = await getPrefs();
    const apiKey = prefs?.elevenLabsApiKey?.trim() || process.env.ElevenLabs_API_Key?.trim();
    if (apiKey) {
      const voiceId = await getElevenLabsVoiceId(apiKey);
      const script = detectScript(text);
      console.log(`[voiceNote] TTS: using ElevenLabs voice ${voiceId}, detected script: ${script}`);

      // If the user has saved custom voice parameters in settings, use those directly.
      // Otherwise fall back to automatic language-aware defaults.
      const customStability = typeof prefs?.voiceNoteStability === "number" ? prefs.voiceNoteStability : null;
      const customSimilarity = typeof prefs?.voiceNoteSimilarityBoost === "number" ? prefs.voiceNoteSimilarityBoost : null;
      const customStyle = typeof prefs?.voiceNoteStyle === "number" ? prefs.voiceNoteStyle : null;
      const customSpeakerBoost = typeof prefs?.voiceNoteSpeakerBoost === "boolean" ? prefs.voiceNoteSpeakerBoost : null;
      const hasCustom = customStability !== null || customSimilarity !== null || customStyle !== null;

      // Language-aware auto-defaults:
      // Urdu/Hindi: do NOT use style — it forces English prosody onto non-English phonemes.
      const autoSettings =
        script === "urdu" || script === "hindi"
          ? { stability: 0.55, similarity_boost: 0.80, style: 0, use_speaker_boost: true }
          : { stability: 0.50, similarity_boost: 0.75, style: 0.10, use_speaker_boost: true };

      const voiceSettings = hasCustom
        ? {
            stability: customStability ?? autoSettings.stability,
            similarity_boost: customSimilarity ?? autoSettings.similarity_boost,
            style: customStyle ?? autoSettings.style,
            use_speaker_boost: customSpeakerBoost ?? autoSettings.use_speaker_boost,
          }
        : autoSettings;

      // For Urdu script text, attach the pronunciation dictionary so ElevenLabs
      // applies the harakat-diacritics aliases for correct Pakistani pronunciation.
      // The dictionary is uploaded once on first use and cached by ID.
      let pronunciationDictionaryLocators: { pronunciation_dictionary_id: string; version_id: string }[] | undefined;
      if (script === "urdu") {
        const locator = await getUrduDictionaryLocator(apiKey);
        if (locator) {
          pronunciationDictionaryLocators = [locator];
          console.log(`[voiceNote] Applying Urdu pronunciation dictionary: ${locator.pronunciation_dictionary_id}`);
        }
      }

      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: voiceSettings,
          ...(pronunciationDictionaryLocators ? { pronunciation_dictionary_locators: pronunciationDictionaryLocators } : {}),
        }),
      });

      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
      const body = await res.text().catch(() => "");
      console.warn(`[voiceNote] ElevenLabs TTS failed (${res.status}): ${body} — trying Groq`);
    }
  } catch (err) {
    console.warn("[voiceNote] ElevenLabs TTS error:", err, "— trying Groq");
  }

  // --- Option 2: Groq TTS (fallback — no IP restrictions, different voice) ---
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      const script = detectScript(text);
      const groqModel = script === "urdu" ? "playai-tts-arabic" : "playai-tts";
      const groqVoice = script === "urdu" ? "Nadia-PlayAI" : "Fritz-PlayAI";
      console.log(`[voiceNote] TTS: using Groq PlayAI fallback (model: ${groqModel}, voice: ${groqVoice})`);
      const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: groqModel,
          input: text,
          voice: groqVoice,
          response_format: "mp3",
        }),
      });

      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
      const body = await res.text().catch(() => "");
      console.error(`[voiceNote] Groq TTS also failed (${res.status}): ${body}`);
    } catch (err) {
      console.error("[voiceNote] Groq TTS error:", err);
    }
  }

  console.warn("[voiceNote] All TTS services failed — sending text reply");
  return null;
}

/**
 * Upload an audio buffer to WhatsApp Media API.
 * Returns the media ID for use in a message.
 */
export async function uploadWhatsAppAudio(
  audioBuffer: Buffer,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
  formData.append("file", blob, "voice_note.mp3");
  formData.append("type", "audio/mpeg");
  formData.append("messaging_product", "whatsapp");

  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[voiceNote] WhatsApp media upload failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error("[voiceNote] No media ID returned from WhatsApp upload");
  return data.id;
}

/**
 * Send an uploaded audio file as a WhatsApp voice note.
 */
export async function sendWhatsAppVoiceNote(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  mediaId: string,
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: mediaId },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[voiceNote] sendWhatsAppVoiceNote failed (${res.status}): ${body}`);
  } else {
    console.log(`[voiceNote] Voice note sent to ${to}`);
  }
}

/**
 * Full pipeline: receive WhatsApp audio → transcribe → run through Zara → reply as voice note.
 * Falls back to a text reply if transcription succeeds but TTS fails.
 * Falls back to an error message if transcription itself fails.
 */
export async function handleWhatsAppVoiceNote(
  mediaId: string,
  from: string,
  phoneNumberId: string,
  accessToken: string,
  processText: (text: string) => Promise<string>,
  sendTextFn: (text: string) => Promise<void>,
): Promise<void> {
  let transcribed = "";
  try {
    console.log(`[voiceNote] Downloading voice note from ${from}, media ${mediaId}`);
    const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId, accessToken);

    console.log(`[voiceNote] Transcribing ${mimeType} audio (${buffer.length} bytes)`);
    transcribed = await transcribeWithWhisper(buffer, mimeType);

    if (!transcribed) {
      await sendTextFn("Sorry, I couldn't make out that voice note. Could you send it as a text message?");
      return;
    }

    console.log(`[voiceNote] Transcribed: "${transcribed}"`);
    const textReply = await processText(transcribed);

    console.log(`[voiceNote] Generating voice reply (${textReply.length} chars)`);
    const audioBuffer = await textToSpeech(textReply);

    if (!audioBuffer) {
      // TTS not available — send text reply instead
      console.warn("[voiceNote] TTS unavailable — sending text reply");
      await sendTextFn(textReply);
      return;
    }

    const uploadedId = await uploadWhatsAppAudio(audioBuffer, phoneNumberId, accessToken);
    await sendWhatsAppVoiceNote(phoneNumberId, accessToken, from, uploadedId);

  } catch (err) {
    console.error("[voiceNote] Pipeline error:", err);
    const fallbackText = transcribed
      ? `Sorry, I had trouble sending a voice reply. Here's my answer:\n\n${await processText(transcribed).catch(() => "Something went wrong. Please try again.")}`
      : "Sorry, I had trouble processing your voice note. Could you send it as text?";
    try { await sendTextFn(fallbackText); } catch { /* ignore */ }
  }
}

/** Exported alias for transcription — used by webhook for boss voice notes */
export { transcribeWithWhisper as transcribeWithElevenLabs };

/**
 * Resolve the ElevenLabs voice ID for test-tts preview calls.
 * Same logic as getElevenLabsVoiceId but accepts prefs directly so the caller controls caching.
 */
export async function getElevenLabsVoiceIdForTest(
  apiKey: string,
  prefs: { voiceNoteVoiceId?: string | null; elevenLabsAgentId?: string | null } | null,
): Promise<string> {
  const directVoiceId = prefs?.voiceNoteVoiceId?.trim();
  if (directVoiceId) return directVoiceId;

  const agentId = prefs?.elevenLabsAgentId?.trim() || process.env.ElevenLabs_Agent_ID?.trim();
  if (agentId) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        headers: { "xi-api-key": apiKey },
      });
      if (res.ok) {
        const data = await res.json() as { conversation_config?: { tts?: { voice_id?: string } } };
        const voiceId = data.conversation_config?.tts?.voice_id;
        if (voiceId) return voiceId;
      }
    } catch { /* fall through to default */ }
  }

  return "21m00Tcm4TlvDq8ikWAM"; // Rachel default
}
