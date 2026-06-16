import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const channelConfigs = pgTable("channel_configs", {
  id: serial("id").primaryKey(),
  channelType: text("channel_type").notNull().unique(),
  status: text("status").notNull().default("disconnected"),
  config: text("config").notNull().default("{}"),
  webhookSecret: text("webhook_secret"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChannelConfig = typeof channelConfigs.$inferSelect;
export type InsertChannelConfig = typeof channelConfigs.$inferInsert;
