import { pgTable, serial, text, integer, timestamp, jsonb, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const bossMemoryTable = pgTable(
  "boss_memory",
  {
    id: serial("id").primaryKey(),
    section: text("section").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    importance: integer("importance").notNull().default(1),
    source: text("source").notNull().default("stated"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("boss_memory_section_key").on(t.section, t.key),
    check("boss_memory_importance_range", sql`${t.importance} between 1 and 3`),
    check("boss_memory_source_enum", sql`${t.source} in ('stated', 'inferred')`),
  ]
);

export type BossMemory = typeof bossMemoryTable.$inferSelect;
export type InsertBossMemory = typeof bossMemoryTable.$inferInsert;
