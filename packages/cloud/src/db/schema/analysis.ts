import type { VacancyAnalysisFacts } from "@otbor/contract"
import { doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { vacancy } from "./corpus.ts"

/**
 * Layer A analysis of a vacancy by the local decision model. Shared like
 * `vacancy`; `answers` is the raw model output, `facts` its interpretation at
 * `threshold`. The primary key makes a prompt version a separate analysis.
 */
export const vacancyAnalysis = pgTable(
  "vacancy_analysis",
  {
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancy.id, { onDelete: "cascade" }),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    facts: jsonb("facts").$type<VacancyAnalysisFacts>().notNull(),
    threshold: doublePrecision("threshold").notNull(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.vacancyId, table.promptVersion] }),
    index("vacancy_analysis_updated_idx").on(table.promptVersion, table.updatedAt)
  ]
)
