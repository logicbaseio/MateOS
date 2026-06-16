import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamChannelsTable = pgTable("team_channels", {
  id: serial("id").primaryKey(),
  teamName: text("team_name").notNull(),
  channelName: text("channel_name").notNull(),
  amazonAccountId: text("amazon_account_id").notNull(),
  amazonAccountName: text("amazon_account_name").notNull(),
  alertTypes: text("alert_types").array().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  msTeamId: text("ms_team_id"),
  msChannelId: text("ms_channel_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTeamChannelSchema = createInsertSchema(teamChannelsTable).omit({ id: true, createdAt: true });
export type InsertTeamChannel = z.infer<typeof insertTeamChannelSchema>;
export type TeamChannel = typeof teamChannelsTable.$inferSelect;
