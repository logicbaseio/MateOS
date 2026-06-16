import { Router, type IRouter } from "express";
import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { syncVoiceAgent } from "../lib/syncVoiceAgent";
import { db } from "@workspace/db";
import { preferencesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function getSoulPath(): string {
  try {
    const url = import.meta.url;
    if (url) return resolve(dirname(fileURLToPath(url)), "../../data/soul.md");
  } catch {}
  return resolve(process.cwd(), "artifacts/api-server/data/soul.md");
}

const SOUL_PATH = getSoulPath();

async function readSoulFromFile(): Promise<string | null> {
  try {
    return await readFile(SOUL_PATH, "utf-8");
  } catch {
    return null;
  }
}

async function writeSoulToFile(content: string): Promise<void> {
  try {
    await writeFile(SOUL_PATH, content, "utf-8");
  } catch (err) {
    console.warn("[soul] Could not write soul.md to disk (read-only fs?):", (err as Error).message);
  }
}

router.get("/soul", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select({ soulContent: preferencesTable.soulContent }).from(preferencesTable).limit(1);
    const dbContent = rows[0]?.soulContent;

    if (dbContent && dbContent.trim().length > 0) {
      res.json({ content: dbContent });
      return;
    }

    const fileContent = await readSoulFromFile();
    if (fileContent) {
      res.json({ content: fileContent });
      return;
    }

    res.status(500).json({ error: "Failed to read soul" });
  } catch (err) {
    console.error("Failed to read soul:", err);
    res.status(500).json({ error: "Failed to read soul" });
  }
});

router.put("/soul", async (req, res): Promise<void> => {
  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content must be a string" });
    return;
  }
  try {
    const existing = await db.select({ id: preferencesTable.id }).from(preferencesTable).limit(1);
    if (existing.length > 0) {
      await db.update(preferencesTable).set({ soulContent: content }).where(eq(preferencesTable.id, existing[0].id));
    } else {
      await db.insert(preferencesTable).values({ soulContent: content });
    }

    void writeSoulToFile(content);

    res.json({ content });

    void syncVoiceAgent();
  } catch (err) {
    console.error("Failed to save soul:", err);
    res.status(500).json({ error: "Failed to save soul" });
  }
});

export default router;
export { SOUL_PATH };
