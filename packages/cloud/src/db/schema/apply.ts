import type { KitAnswer, ResponseForm, StoredHint } from "@otbor/contract"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"
import { users, vacancy } from "./corpus.ts"
import { hhAccount, resume } from "./candidate.ts"
import { keyword } from "./lexicon.ts"

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
const uuidPk = () => uuid("id").primaryKey().default(sql`uuidv7()`)

export const decision = pgTable(
  "decision",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id").references(() => hhAccount.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id").references(() => resume.id, { onDelete: "set null" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    gate: text("gate").notNull(),
    roleFamily: text("role_family"),
    fit: integer("fit").notNull().default(0),
    priority: doublePrecision("priority").notNull().default(0),
    reasons: jsonb("reasons").$type<ReadonlyArray<unknown>>().notNull().default([]),
    policyVersion: integer("policy_version").notNull(),
    rulesVersion: integer("rules_version").notNull(),
    inputHash: text("input_hash").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("decision_input_idx").on(
      table.userId,
      table.vacancyId,
      table.policyVersion,
      table.inputHash
    ),
    index("decision_user_created_idx").on(table.userId, table.createdAt)
  ]
)

export const preset = pgTable(
  "preset",
  {
    id: uuidPk(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("apply"),
    title: text("title").notNull(),
    filter: jsonb("filter").$type<Record<string, unknown>>().notNull().default({ all: [] }),
    system: boolean("system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("preset_user_kind_idx").on(table.userId, table.kind)]
)

export const searchQuery = pgTable("search_query", {
  id: uuidPk(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull().unique(),
  title: text("title"),
  textQuery: text("text_query"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

export const searchRun = pgTable("search_run", {
  id: uuidPk(),
  queryId: uuid("query_id")
    .notNull()
    .references(() => searchQuery.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  nextPage: integer("next_page"),
  pagesDone: integer("pages_done").notNull().default(0),
  found: integer("found").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true })
})

export const vacancySearchHit = pgTable(
  "vacancy_search_hit",
  {
    queryId: uuid("query_id")
      .notNull()
      .references(() => searchQuery.id, { onDelete: "cascade" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    position: integer("position"),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ name: "vacancy_search_hit_pkey", columns: [table.queryId, table.vacancyId] })]
)

export const schedule = pgTable(
  "schedule",
  {
    id: uuidPk(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    intervalMinutes: integer("interval_minutes").notNull(),
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("schedule_next_run_idx").on(table.nextRunAt)]
)

export const scheduleRun = pgTable(
  "schedule_run",
  {
    id: uuidPk(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [index("schedule_run_schedule_started_idx").on(table.scheduleId, table.startedAt)]
)

export const hiddenTarget = pgTable(
  "hidden_target",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for `app` rows; always set for `hh_account`/`hh_native` rows. */
    hhAccountId: uuid("hh_account_id").references(() => hhAccount.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("hh_account"),
    type: text("type").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    source: text("source").notNull().default("user"),
    reason: text("reason"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    // Legacy index kept for rows written before scopes were introduced.
    uniqueIndex("hidden_target_unique_idx").on(table.hhAccountId, table.type, table.externalId),
    uniqueIndex("hidden_target_app_unique_idx")
      .on(table.userId, table.type, table.externalId)
      .where(sql`scope = 'app'`),
    uniqueIndex("hidden_target_account_scope_unique_idx")
      .on(table.hhAccountId, table.type, table.externalId)
      .where(sql`scope in ('hh_account', 'hh_native')`)
  ]
)

export const hiddenRule = pgTable("hidden_rule", {
  id: uuidPk(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hhAccountId: uuid("hh_account_id")
    .notNull()
    .references(() => hhAccount.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  pattern: text("pattern").notNull(),
  source: text("source").notNull().default("user"),
  createdAt: createdAt()
})

export const stream = pgTable(
  "stream",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id")
      .notNull()
      .references(() => hhAccount.id, { onDelete: "cascade" }),
    name: text("name"),
    presetId: uuid("preset_id").references(() => preset.id, { onDelete: "set null" }),
    searchQueryId: uuid("search_query_id").references(() => searchQuery.id, {
      onDelete: "set null"
    }),
    mode: text("mode").notNull().default("drafts"),
    letterPolicy: text("letter_policy").notNull().default("required"),
    testsPolicy: text("tests_policy").notNull().default("human"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("stream_account_idx").on(table.hhAccountId)]
)

export const application = pgTable(
  "application",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id")
      .notNull()
      .references(() => hhAccount.id, { onDelete: "cascade" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id").references(() => resume.id, { onDelete: "set null" }),
    streamId: uuid("stream_id").references(() => stream.id, { onDelete: "set null" }),
    decisionId: uuid("decision_id").references(() => decision.id, { onDelete: "set null" }),
    state: text("state").notNull().default("draft"),
    intentAt: timestamp("intent_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("application_account_vacancy_idx").on(table.hhAccountId, table.vacancyId),
    uniqueIndex("application_id_user_idx").on(table.id, table.userId),
    index("application_user_state_idx").on(table.userId, table.state, table.updatedAt)
  ]
)

export const applicationKit = pgTable(
  "application_kit",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").notNull(),
    formHash: text("form_hash").notNull(),
    letter: text("letter"),
    answers: jsonb("answers").$type<ReadonlyArray<KitAnswer>>().notNull().default([]),
    model: text("model"),
    promptHash: text("prompt_hash"),
    costUsd: doublePrecision("cost_usd"),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("application_kit_form_idx").on(table.applicationId, table.formHash),
    foreignKey({
      name: "kit_application_user",
      columns: [table.applicationId, table.userId],
      foreignColumns: [application.id, application.userId]
    }).onDelete("cascade")
  ]
)

export const applicationForm = pgTable(
  "application_form",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").notNull(),
    formHash: text("form_hash").notNull(),
    layout: text("layout").notNull(),
    form: jsonb("form").$type<ResponseForm>().notNull(),
    hints: jsonb("hints").$type<ReadonlyArray<StoredHint>>().notNull().default([]),
    url: text("url").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("application_form_hash_idx").on(table.applicationId, table.formHash),
    foreignKey({
      name: "form_application_user",
      columns: [table.applicationId, table.userId],
      foreignColumns: [application.id, application.userId]
    }).onDelete("cascade")
  ]
)

export const applicationAttempt = pgTable(
  "application_attempt",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").notNull(),
    seq: integer("seq").notNull(),
    stage: text("stage").notNull(),
    harnessId: uuid("harness_id"),
    exit: jsonb("exit").$type<Record<string, unknown>>(),
    artifacts: jsonb("artifacts").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("application_attempt_seq_idx").on(table.applicationId, table.seq),
    foreignKey({
      name: "attempt_application_user",
      columns: [table.applicationId, table.userId],
      foreignColumns: [application.id, application.userId]
    }).onDelete("cascade")
  ]
)

export const fit = pgTable(
  "fit",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id")
      .notNull()
      .references(() => hhAccount.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resume.id, { onDelete: "cascade" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    resumeHash: text("resume_hash").notNull(),
    promptHash: text("prompt_hash").notNull(),
    model: text("model").notNull(),
    verdict: text("verdict").notNull(),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<ReadonlyArray<unknown>>().notNull().default([]),
    costUsd: doublePrecision("cost_usd"),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("fit_cache_idx").on(
      table.vacancyId,
      table.resumeId,
      table.contentHash,
      table.resumeHash,
      table.promptHash,
      table.model
    )
  ]
)

export const harness = pgTable("harness", {
  id: uuidPk(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kinds: jsonb("kinds").$type<ReadonlyArray<string>>().notNull().default([]),
  tokenHash: text("token_hash"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

export const harnessAccount = pgTable(
  "harness_account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    harnessId: uuid("harness_id")
      .notNull()
      .references(() => harness.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id")
      .notNull()
      .references(() => hhAccount.id, { onDelete: "cascade" }),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({
      name: "harness_account_pkey",
      columns: [table.harnessId, table.hhAccountId]
    }),
    uniqueIndex("harness_account_single_idx").on(table.hhAccountId)
  ]
)

export const harnessJob = pgTable(
  "harness_jobs",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hhAccountId: uuid("hh_account_id").references(() => hhAccount.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => application.id, {
      onDelete: "cascade"
    }),
    stage: text("stage").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** ACP inference output, filled on completion. */
    result: jsonb("result").$type<unknown>(),
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    leaseId: uuid("lease_id"),
    leaseEpoch: integer("lease_epoch").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("harness_jobs_claim_idx").on(table.kind, table.status, table.runAt, table.priority),
    index("harness_jobs_account_idx").on(table.hhAccountId, table.status),
    index("harness_jobs_application_idx").on(table.applicationId),
    check("submit_is_single_attempt", sql`${table.stage} <> 'submit' or ${table.maxAttempts} <= 1`)
  ]
)

export const accountLease = pgTable("account_lease", {
  hhAccountId: uuid("hh_account_id")
    .primaryKey()
    .references(() => hhAccount.id, { onDelete: "cascade" }),
  holder: text("holder").notNull(),
  epoch: integer("epoch").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
})
