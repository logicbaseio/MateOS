import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const microsoftTokens = pgTable("microsoft_tokens", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  userEmail: text("user_email"),
  userId: text("user_id"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
