import { Router, type IRouter } from "express";
import { db, preferencesTable } from "@workspace/db";
import { getElevenLabsVoiceIdForTest } from "../lib/voiceNote";

const router: IRouter = Router();

/**
 * POST /api/voice-note/test-tts
 * Preview how the assistant's voice note will sound with specific parameters.
 * Accepts { text, stability, similarityBoost, style, speakerBoost } and streams back audio/mpeg.
 */
router.post("/voice-note/test-tts", async (req, res): Promise<void> => {
  const { text, stability, similarityBoost, style, speakerBoost } = req.body as {
    text?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
  };

  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const [prefs] = await db.select().from(preferencesTable).limit(1);
  const apiKey = prefs?.elevenLabsApiKey?.trim() || process.env.ElevenLabs_API_Key?.trim();

  if (!apiKey) {
    res.status(400).json({ error: "No ElevenLabs API key configured in Bot Settings." });
    return;
  }

  const voiceId = await getElevenLabsVoiceIdForTest(apiKey, prefs ?? null);

  const voiceSettings = {
    stability: typeof stability === "number" ? stability : 0.55,
    similarity_boost: typeof similarityBoost === "number" ? similarityBoost : 0.80,
    style: typeof style === "number" ? style : 0,
    use_speaker_boost: typeof speakerBoost === "boolean" ? speakerBoost : true,
  };

  const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text: text.trim(), model_id: "eleven_multilingual_v2", voice_settings: voiceSettings }),
  });

  if (!elRes.ok) {
    const body = await elRes.text().catch(() => "");
    res.status(502).json({ error: `ElevenLabs TTS failed (${elRes.status}): ${body}` });
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  const audioBuffer = Buffer.from(await elRes.arrayBuffer());
  res.end(audioBuffer);
});

export default router;
