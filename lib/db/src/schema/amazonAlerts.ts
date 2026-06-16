import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const amazonAlertsTable = pgTable("amazon_alerts", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  senderEmail: text("sender_email").notNull(),
  amazonAccountId: text("amazon_account_id").notNull(),
  alertType: text("alert_type").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  routedToTeam: text("routed_to_team"),
  routedToChannel: text("routed_to_channel"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const insertAmazonAlertSchema = createInsertSchema(amazonAlertsTable).omit({ id: true });
export type InsertAmazonAlert = z.infer<typeof insertAmazonAlertSchema>;
export type AmazonAlert = typeof amazonAlertsTable.$inferSelect;
