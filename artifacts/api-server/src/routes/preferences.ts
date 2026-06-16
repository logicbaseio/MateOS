import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import { db, preferencesTable } from "@workspace/db";
import {
  GetPreferencesResponse,
  UpdatePreferencesBody,
  UpdatePreferencesResponse,
} from "@workspace/api-zod";
import { syncVoiceAgent } from "../lib/syncVoiceAgent";
import { SOUL_PATH } from "../brain/engine";

async function readSoulContent(row: { soulContent?: string | null }): Promise<string | null> {
  if (row.soulContent && row.soulContent.trim().length > 0) return row.soulContent;
  try { return await readFile(SOUL_PATH, "utf-8"); } catch { return null; }
}

async function saveSoulContent(id: number, content: string): Promise<void> {
  try {
    await db.update(preferencesTable).set({ soulContent: content }).where(eq(preferencesTable.id, id));
  } catch (err) {
    console.warn("[preferences] DB soul save failed:", (err as Error).message);
  }
  try { await writeFile(SOUL_PATH, content, "utf-8"); } catch { /* read-only fs ok */ }
}

const router: IRouter = Router();

router.get("/preferences", async (_req, res): Promise<void> => {
  let [prefs] = await db.select().from(preferencesTable).limit(1);
  if (!prefs) {
    [prefs] = await db.insert(preferencesTable).values({}).returning();
  }
  res.json(GetPreferencesResponse.parse(prefs));
});

router.put("/preferences", async (req, res): Promise<void> => {
  const parsed = UpdatePreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [existing] = await db.select().from(preferencesTable).limit(1);
  if (!existing) {
    [existing] = await db.insert(preferencesTable).values({}).returning();
  }

  const oldBotName: string = (existing as any).botName ?? "Mate";
  const oldBossName: string = existing.bossName ?? "Owner";
  const newBotName: string | undefined = (parsed.data as any).botName;
  const newBossName: string | undefined = (parsed.data as any).bossName;

  const [updated] = await db
    .update(preferencesTable)
    .set(parsed.data)
    .where(eq(preferencesTable.id, existing.id))
    .returning();

  res.json(UpdatePreferencesResponse.parse(updated));

  // Sync name changes into soul content (DB + file) so names stay consistent
  void (async () => {
    try {
      const nameChanged =
        (newBotName && newBotName !== oldBotName) ||
        (newBossName && newBossName !== oldBossName);
      if (!nameChanged) return;

      const currentRow = await db.select({ soulContent: preferencesTable.soulContent }).from(preferencesTable).where(eq(preferencesTable.id, existing.id)).limit(1);
      let soul = await readSoulContent(currentRow[0] ?? {});
      if (!soul) return;

      if (newBotName && newBotName !== oldBotName) {
        soul = soul.replace(new RegExp(`\\b${oldBotName}\\b`, "g"), newBotName);
      }
      if (newBossName && newBossName !== oldBossName) {
        soul = soul.replace(new RegExp(`\\b${oldBossName}\\b`, "g"), newBossName);
      }
      await saveSoulContent(existing.id, soul);
      console.log(`[preferences] soul updated: ${oldBotName} → ${newBotName ?? oldBotName}, ${oldBossName} → ${newBossName ?? oldBossName}`);
    } catch (err) {
      console.warn("[preferences] Failed to sync name into soul:", err);
    }
  })();

  // Fire-and-forget: push updated preferences to ElevenLabs agent
  void syncVoiceAgent();
});

export default router;
