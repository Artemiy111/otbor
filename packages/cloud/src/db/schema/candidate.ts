import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"
import { users } from "./corpus.ts"

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
const uuidPk = () => uuid("id").primaryKey().default(sql`uuidv7()`)

export const hhAccount = pgTable(
  "hh_account",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    isDefault: boolean("is_default").notNull().default(false),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    areaName: text("area_name"),
    sessionProfile: text("session_profile"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("hh_account_user_idx").on(table.userId)]
)

export const resume = pgTable(
  "resume",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id")
      .notNull()
      .references(() => hhAccount.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("hh"),
    externalId: text("external_id").notNull(),
    hash: text("hash").notNull(),
    contentHash: text("content_hash"),
    title: text("title").notNull(),
    text: text("text").notNull(),
    about: text("about").notNull().default(""),
    skills: jsonb("skills").$type<ReadonlyArray<string>>().notNull().default([]),
    experience: jsonb("experience").$type<ReadonlyArray<unknown>>().notNull().default([]),
    education: jsonb("education").$type<ReadonlyArray<unknown>>().notNull().default([]),
    workFormats: jsonb("work_formats").$type<ReadonlyArray<string>>().notNull().default([]),
    salaryAmount: integer("salary_amount"),
    salaryCurrency: text("salary_currency"),
    status: text("status"),
    isActive: boolean("is_active").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("resume_source_external_idx").on(table.source, table.externalId),
    index("resume_account_idx").on(table.hhAccountId)
  ]
)

export const resumeSnapshot = pgTable(
  "resume_snapshot",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resume.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw").notNull()
  },
  (table) => [uniqueIndex("resume_snapshot_hash_idx").on(table.resumeId, table.contentHash)]
)

export const resumeEnrichment = pgTable("resume_enrichment", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  resumeId: uuid("resume_id")
    .primaryKey()
    .references(() => resume.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt()
})

export const hhAccountSession = pgTable("hh_account_session", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hhAccountId: uuid("hh_account_id")
    .primaryKey()
    .references(() => hhAccount.id, { onDelete: "cascade" }),
  sealed: text("sealed"),
  state: text("state").notNull().default("expired"),
  proxyNode: text("proxy_node"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: updatedAt()
})
