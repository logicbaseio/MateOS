import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, bossMemoryTable, type BossMemory } from "@workspace/db";
import { getBossPersona, generateBossPersona } from "../brain/persona";
import { syncVoiceAgent } from "../lib/syncVoiceAgent";

const router: IRouter = Router();

router.get("/boss-memory", async (_req, res): Promise<void> => {
  const memories = await db
    .select()
    .from(bossMemoryTable)
    .orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key));

  const grouped = memories.reduce<Record<string, BossMemory[]>>((acc, m) => {
    if (!acc[m.section]) acc[m.section] = [];
    acc[m.section].push(m);
    return acc;
  }, {});

  res.json(grouped);
});

router.get("/boss-persona", async (_req, res): Promise<void> => {
  try {
    const { persona, updatedAt } = await getBossPersona();
    res.json({ persona, updatedAt: updatedAt?.toISOString() ?? null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/boss-persona/refresh", async (_req, res): Promise<void> => {
  try {
    const persona = await generateBossPersona();
    res.json({ persona, updatedAt: new Date().toISOString() });
    // Fire-and-forget: push updated persona to ElevenLabs agent
    void syncVoiceAgent();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
