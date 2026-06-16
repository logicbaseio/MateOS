import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const brainMessages = pgTable("brain_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolName: text("tool_name"),
  toolCallId: text("tool_call_id"),
  toolInput: text("tool_input"),
  toolResult: text("tool_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BrainMessage = typeof brainMessages.$inferSelect;
export type InsertBrainMessage = typeof brainMessages.$inferInsert;
