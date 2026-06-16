import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botConversationsTable = pgTable("bot_conversations", {
  id: serial("id").primaryKey(),
  botType: text("bot_type").notNull(),
  participant: text("participant").notNull(),
  messages: text("messages").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotConversationSchema = createInsertSchema(botConversationsTable).omit({ id: true, createdAt: true });
export type InsertBotConversation = z.infer<typeof insertBotConversationSchema>;
export type BotConversation = typeof botConversationsTable.$inferSelect;
