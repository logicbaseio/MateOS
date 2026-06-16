import { asc, eq } from "drizzle-orm";
import { db, bossMemoryTable, preferencesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const PERSONA_MODEL = "gpt-4.1-mini";

export async function generateBossPersona(): Promise<string> {
  try {
    const [allMemories, prefs] = await Promise.all([
      db.select().from(bossMemoryTable).orderBy(asc(bossMemoryTable.section), asc(bossMemoryTable.key)),
      db.select().from(preferencesTable).limit(1),
    ]);

    const pref = prefs[0];
    const bossName = pref?.bossName?.trim() || "Owner";
    const botName = pref?.botName?.trim() || "Mate";

    const grouped: Record<string, typeof allMemories> = {};
    for (const m of allMemories) {
      if (!grouped[m.section]) grouped[m.section] = [];
      grouped[m.section].push(m);
    }

    const memoryLines = Object.entries(grouped).map(([section, items]) => {
      const lines = items.map(m => {
        const imp = m.importance === 3 ? " [CRITICAL]" : m.importance === 2 ? " [important]" : "";
        return `  ${m.key}: ${m.value}${imp}`;
      });
      return `[${section.toUpperCase()}]\n${lines.join("\n")}`;
    }).join("\n\n");

    const prefsBlock = pref ? [
      `Name: ${pref.bossName}`,
      `Timezone: ${pref.timezone}`,
      `Current city: ${pref.currentCity}`,
      `Mood/status: ${pref.mood}`,
      `Preferred meeting time: ${pref.preferredMeetingTime}`,
      `Max meetings/day: ${pref.maxMeetingsPerDay}`,
      `Meeting duration: ${pref.meetingDurationMinutes} min`,
      `Buffer between meetings: ${pref.breakBetweenMeetings} min`,
      `Workday: ${pref.workdayStart} – ${pref.workdayEnd}`,
      pref.notes ? `Notes: ${pref.notes}` : "",
    ].filter(Boolean).join("\n") : "";

    const systemMsg = `You are generating a comprehensive owner persona for ${botName}, an AI assistant who handles scheduling and represents ${bossName} in conversations with clients, callers, and collaborators.

${botName} needs this persona to:
- Accurately introduce and describe the boss when asked who he is, what he does, or what his company is
- Know his availability windows, scheduling rules, and current status
- Understand priority rules for who gets meetings and how they are filtered
- Represent him professionally and accurately in all conversations

CRITICAL RULE: Include EVERYTHING that matters — professional identity, business background, work, key relationships, scheduling constraints, location, current situation, and any facts marked [CRITICAL] or [important]. Do NOT restrict yourself to scheduling-only data.

Items marked [CRITICAL] in memory MUST be included verbatim or very closely paraphrased.
Items marked [important] should be included unless clearly redundant.
Omit only genuinely trivial or redundant details.

Format as clean structured text with labeled sections. Use present tense. Keep it under 600 words but prioritize completeness over brevity — missing a critical fact is worse than being slightly longer.`;

    const userMsg = `Boss Preferences (from system):
${prefsBlock}

Boss Memory (ALL sections):
${memoryLines || "(no memory entries yet)"}

Generate the full owner persona for ${bossName} now.`;

    const response = await openai.chat.completions.create({
      model: PERSONA_MODEL,
      max_completion_tokens: 900,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
    });

    const persona = response.choices[0]?.message?.content?.trim() ?? "";

    if (persona) {
      const rows = await db.select().from(preferencesTable).limit(1);
      if (rows[0]) {
        await db.update(preferencesTable)
          .set({ bossPersona: persona, bossPersonaUpdatedAt: new Date() })
          .where(eq(preferencesTable.id, rows[0].id));
      }
      console.log("[persona] Boss persona generated/refreshed, length:", persona.length);
    }

    return persona;
  } catch (err) {
    console.error("[persona] Generation failed:", err);
    throw err;
  }
}

export async function getBossPersona(): Promise<{ persona: string; updatedAt: Date | null }> {
  const rows = await db.select().from(preferencesTable).limit(1);
  const pref = rows[0];
  if (!pref) return { persona: "", updatedAt: null };
  return {
    persona: pref.bossPersona ?? "",
    updatedAt: pref.bossPersonaUpdatedAt ?? null,
  };
}

export async function ensureFreshPersona(): Promise<string> {
  const { persona, updatedAt } = await getBossPersona();
  const STALE_MS = 30 * 60 * 1000;
  const isStale = !updatedAt || (Date.now() - updatedAt.getTime() > STALE_MS);

  if (!persona || isStale) {
    return generateBossPersona();
  }
  return persona;
}

export function schedulePersonaRefresh(): void {
  setTimeout(() => {
    generateBossPersona().catch(err => console.error("[persona] Startup refresh failed:", err));
  }, 6000);

  setInterval(() => {
    generateBossPersona().catch(err => console.error("[persona] Scheduled refresh failed:", err));
  }, 30 * 60 * 1000);
}
