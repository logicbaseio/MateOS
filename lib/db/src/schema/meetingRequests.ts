import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const meetingRequestsTable = pgTable("meeting_requests", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email").notNull(),
  requesterPhone: text("requester_phone"),
  purpose: text("purpose").notNull(),
  urgency: text("urgency").notNull().default("medium"),
  preferredDate: timestamp("preferred_date", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  scheduledTime: timestamp("scheduled_time", { withTimezone: true }),
  botSuggestion: text("bot_suggestion"),
  bossResponse: text("boss_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMeetingRequestSchema = createInsertSchema(meetingRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeetingRequest = z.infer<typeof insertMeetingRequestSchema>;
export type MeetingRequest = typeof meetingRequestsTable.$inferSelect;
