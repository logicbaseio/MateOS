import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const channelSessions = pgTable("channel_sessions", {
  id: serial("id").primaryKey(),
  channelType: text("channel_type").notNull(),
  externalId: text("external_id").notNull(),
  messages: text("messages").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChannelSession = typeof channelSessions.$inferSelect;
export type InsertChannelSession = typeof channelSessions.$inferInsert;
