import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const bossNotifications = pgTable("boss_notifications", {
  id: serial("id").primaryKey(),
  channelType: text("channel_type").notNull(),
  externalId: text("external_id").notNull(),
  sessionId: text("session_id").notNull(),
  notificationText: text("notification_text").notNull(),
  customerContext: text("customer_context").notNull(),
  status: text("status").notNull().default("pending"),
  bossReply: text("boss_reply"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BossNotification = typeof bossNotifications.$inferSelect;
export type InsertBossNotification = typeof bossNotifications.$inferInsert;
