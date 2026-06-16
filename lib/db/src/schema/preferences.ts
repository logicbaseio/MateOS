import { pgTable, text, serial, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const preferencesTable = pgTable("preferences", {
  id: serial("id").primaryKey(),
  bossName: text("boss_name").notNull().default("Owner"),
  botName: text("bot_name").notNull().default("Mate"),
  timezone: text("timezone").notNull().default("UTC"),
  currentCity: text("current_city").notNull().default("Remote"),
  mood: text("mood").notNull().default("available"),
  preferredMeetingTime: text("preferred_meeting_time").notNull().default("afternoon"),
  maxMeetingsPerDay: integer("max_meetings_per_day").notNull().default(5),
  meetingDurationMinutes: integer("meeting_duration_minutes").notNull().default(30),
  breakBetweenMeetings: integer("break_between_meetings").notNull().default(15),
  notes: text("notes").notNull().default(""),
  workdayStart: text("workday_start").default("09:00"),
  workdayEnd: text("workday_end").default("17:00"),
  bossPhone: text("boss_phone").default(""),
  bossTools: text("boss_tools").default("calendar,email,teams,meeting_requests,preferences"),
  customerTools: text("customer_tools").default("submit_meeting_request"),
  toolConfig: text("tool_config").default(""),
  brainTeamsChatId: text("brain_teams_chat_id").default(""),
  brainTeamsSubId: text("brain_teams_sub_id").default(""),
  brainTeamsSubExpiry: timestamp("brain_teams_sub_expiry", { withTimezone: true }),
  brainTeamsType: text("brain_teams_type").default("chat"),
  brainTeamsTeamId: text("brain_teams_team_id").default(""),
  brainTelegramToken: text("brain_telegram_token").default(""),
  brainTelegramChatId: text("brain_telegram_chat_id").default(""),
  bossPersona: text("boss_persona").default(""),
  bossPersonaUpdatedAt: timestamp("boss_persona_updated_at", { withTimezone: true }),
  elevenLabsApiKey: text("eleven_labs_api_key").default(""),
  elevenLabsAgentId: text("eleven_labs_agent_id").default(""),
  elevenLabsPhoneNumberId: text("eleven_labs_phone_number_id").default(""),
  voiceNoteVoiceId: text("voice_note_voice_id").default(""),
  voiceNoteInstructions: text("voice_note_instructions").default(""),
  voiceNoteStability: real("voice_note_stability"),
  voiceNoteSimilarityBoost: real("voice_note_similarity_boost"),
  voiceNoteStyle: real("voice_note_style"),
  voiceNoteSpeakerBoost: boolean("voice_note_speaker_boost").default(true),
  soulContent: text("soul_content").default(""),
  customLlmProvider: text("custom_llm_provider").default("replit"),
  customLlmApiKey: text("custom_llm_api_key").default(""),
  customLlmModel: text("custom_llm_model").default(""),
  customLlmBaseUrl: text("custom_llm_base_url").default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPreferencesSchema = createInsertSchema(preferencesTable).omit({ id: true, updatedAt: true });
export type InsertPreferences = z.infer<typeof insertPreferencesSchema>;
export type Preferences = typeof preferencesTable.$inferSelect;
