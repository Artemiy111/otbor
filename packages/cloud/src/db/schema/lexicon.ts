import { sql } from "drizzle-orm"
import {
  boolean,
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
import { vacancy } from "./corpus.ts"

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
const uuidPk = () => uuid("id").primaryKey().default(sql`uuidv7()`)

export const keyword = pgTable(
  "keyword",
  {
    id: uuidPk(),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [uniqueIndex("keyword_normalized_idx").on(table.normalizedTerm)]
)

export const keywordAlias = pgTable(
  "keyword_alias",
  {
    id: uuidPk(),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keyword.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    matchType: text("match_type").notNull().default("word"),
    typo: boolean("typo").notNull().default(false)
  },
  (table) => [uniqueIndex("keyword_alias_unique_idx").on(table.keywordId, table.normalizedAlias)]
)

/**
 * One row per matched form. `matched_form` is normalized, so `Kubernetes` and
 * `kubernetes` collapse while `k8s` stays separate. `alias_id` links the form
 * to the dictionary entry; `matched_form` survives alias deletion.
 */
export const vacancyKeyword = pgTable(
  "vacancy_keyword",
  {
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keyword.id, { onDelete: "cascade" }),
    aliasId: uuid("alias_id").references(() => keywordAlias.id, { onDelete: "set null" }),
    matchedForm: text("matched_form").notNull(),
    inTitle: boolean("in_title").notNull().default(false),
    titleCount: integer("title_count").notNull().default(0),
    inBody: boolean("in_body").notNull().default(false),
    bodyCount: integer("body_count").notNull().default(0),
    inSkills: boolean("in_skills").notNull().default(false),
    typo: boolean("typo").notNull().default(false),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({
      name: "vacancy_keyword_pkey",
      columns: [table.vacancyId, table.keywordId, table.matchedForm]
    }),
    index("vacancy_keyword_title_idx").on(table.keywordId),
    index("vacancy_keyword_body_idx").on(table.keywordId),
    index("vacancy_keyword_keyword_vacancy_idx").on(table.keywordId, table.vacancyId),
    index("vacancy_keyword_skills_idx").on(table.keywordId, table.vacancyId)
  ]
)
