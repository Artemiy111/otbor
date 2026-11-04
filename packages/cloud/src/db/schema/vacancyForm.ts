import type { ResponseForm } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { hhAccount } from "./candidate.ts"
import { vacancy } from "./corpus.ts"

/**
 * The hh response form of a vacancy, as immutable versions. Shared like
 * `vacancy`: every applicant sees the same questions. A version is keyed by the
 * form hash, so an employer reverting an edit reuses the older row.
 */
export const vacancyFormVersion = pgTable(
  "vacancy_form_version",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    formHash: text("form_hash").notNull(),
    layout: text("layout").notNull(),
    coverLetter: text("cover_letter").notNull(),
    form: jsonb("form").$type<ResponseForm>().notNull(),
    url: text("url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("vacancy_form_version_hash_idx").on(table.vacancyId, table.formHash)]
)

/** What hh shows for a vacancy now: one row per vacancy. */
export const vacancyFormState = pgTable(
  "vacancy_form_state",
  {
    vacancyId: uuid("vacancy_id")
      .primaryKey()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    currentVersionId: uuid("current_version_id").references(() => vacancyFormVersion.id, {
      onDelete: "set null"
    }),
    status: text("status").$type<"none" | "present" | "unreadable" | "gone">().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    checkedByAccountId: uuid("checked_by_account_id").references(() => hhAccount.id, {
      onDelete: "set null"
    }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true })
  },
  (table) => [index("vacancy_form_state_checked_idx").on(table.checkedAt)]
)
