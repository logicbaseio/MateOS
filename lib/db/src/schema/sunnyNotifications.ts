import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const sunnyNotifications = pgTable("sunny_notifications", {
  id: serial("id").primaryKey(),
  channelType: text("channel_type").notNull(),
  externalId: text("external_id").notNull(),
  sessionId: text("session_id").notNull(),
  notificationText: text("notification_text").notNull(),
  customerContext: text("customer_context").notNull(),
  status: text("status").notNull().default("pending"),
  sunnyReply: text("sunny_reply"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SunnyNotification = typeof sunnyNotifications.$inferSelect;
export type InsertSunnyNotification = typeof sunnyNotifications.$inferInsert;
