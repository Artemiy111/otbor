import { sql } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"

/**
 * Drizzle is the persistence contract: repositories use these tables for
 * typed queries, while hand-written SQL handles RLS sessions, queue claims and
 * upserts where the query builder would only add noise.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
const uuidPk = () => uuid("id").primaryKey().default(sql`uuidv7()`)

/** Better Auth's `user`. Only the columns the core touches are declared. */
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow()
})

export const employer = pgTable(
  "employer",
  {
    id: uuidPk(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    rating: doublePrecision("rating"),
    reviewsCount: integer("reviews_count"),
    recommendationsPercent: integer("recommendations_percent"),
    siteUrl: text("site_url"),
    logoUrl: text("logo_url"),
    industries: jsonb("industries").$type<ReadonlyArray<string>>().notNull().default([]),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [uniqueIndex("employer_source_external_idx").on(table.source, table.externalId)]
)

export const vacancy = pgTable(
  "vacancy",
  {
    id: uuidPk(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    employerId: uuid("employer_id").references(() => employer.id, { onDelete: "set null" }),
    areaId: integer("area_id"),
    areaName: text("area_name"),
    salaryFrom: integer("salary_from"),
    salaryTo: integer("salary_to"),
    salaryCurrency: text("salary_currency"),
    salaryGross: boolean("salary_gross"),
    salaryNegotiable: boolean("salary_negotiable").notNull().default(false),
    experienceCode: text("experience_code"),
    employmentForm: text("employment_form"),
    workFormats: jsonb("work_formats").$type<ReadonlyArray<string>>().notNull().default([]),
    seniority: text("seniority").notNull().default("unknown"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archived: boolean("archived").notNull().default(false),
    descriptionText: text("description_text"),
    descriptionHtml: text("description_html"),
    hydrationStatus: text("hydration_status").notNull().default("full"),
    cardSnippet: text("card_snippet"),
    contentHash: text("content_hash").notNull(),
    responsesTotal: integer("responses_total"),
    responsesVacancy: integer("responses_vacancy"),
    signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("vacancy_source_external_idx").on(table.source, table.externalId),
    index("vacancy_published_idx").on(table.publishedAt),
    index("vacancy_employer_idx").on(table.employerId)
  ]
)

export const vacancySnapshot = pgTable(
  "vacancy_snapshot",
  {
    id: uuidPk(),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    adapter: text("adapter"),
    raw: jsonb("raw").notNull(),
    descriptionText: text("description_text")
  },
  (table) => [uniqueIndex("vacancy_snapshot_hash_idx").on(table.vacancyId, table.contentHash)]
)

export const vacancySkill = pgTable(
  "vacancy_skill",
  {
    id: uuidPk(),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    source: text("source").notNull().default("hh"),
    position: integer("position")
  },
  (table) => [
    uniqueIndex("vacancy_skill_unique_idx").on(table.vacancyId, table.normalizedTerm, table.source)
  ]
)

export const vacancyResponseSample = pgTable(
  "vacancy_response_sample",
  {
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    total: integer("total"),
    vacancyCount: integer("vacancy"),
    source: text("source").notNull()
  },
  (table) => [index("vacancy_response_sample_bucket_idx").on(table.vacancyId, table.bucket)]
)
