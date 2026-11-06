import { Schema } from "effect"
import { CrawlRunStatus, ScheduleKind, SourceSyncKind } from "../enums.ts"
import { ScheduleId, ScheduleRunId, SearchQueryId, SearchRunId } from "../ids.ts"

/**
 * One persisted crawl. `nextPage` is both the resume cursor and, right after
 * start, the page the run began on: `search_run` has no separate start column
 * and a resumed run is exactly "start here next time".
 */
export const CrawlRun = Schema.Struct({
  runId: SearchRunId,
  queryId: SearchQueryId,
  normalizedUrl: Schema.String,
  status: CrawlRunStatus,
  nextPage: Schema.Int,
  /** Zero-based page currently being crawled or last completed; null for legacy rows. */
  currentPage: Schema.NullOr(Schema.Int),
  /** Total pages reported by the search engine; null until known. */
  pagesTotal: Schema.NullOr(Schema.Int),
  pagesDone: Schema.Int,
  found: Schema.Int,
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  error: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type CrawlRun = typeof CrawlRun.Type

/**
 * A recurring crawl of one saved search. `targetId` is the hh search URL, not
 * a `search_query` id, because a schedule outlives any single run and the URL
 * is what the crawler actually needs.
 *
 * `lastError` is the last failure text; a successful run clears it. Null
 * timestamps mean "never happened" rather than "unknown".
 */
export const CrawlSchedule = Schema.Struct({
  id: ScheduleId,
  kind: ScheduleKind,
  targetId: Schema.String,
  intervalMinutes: Schema.Int,
  /** Per-kind knobs (`limit`, `delayMs`, `dialogs`, `messages`, …). */
  options: Schema.Record(Schema.String, Schema.Unknown),
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type CrawlSchedule = typeof CrawlSchedule.Type

export const ScheduleRun = Schema.Struct({
  id: ScheduleRunId,
  scheduleId: ScheduleId,
  kind: SourceSyncKind,
  status: Schema.Literals(["running", "done", "error"]),
  detail: Schema.optional(Schema.NullOr(Schema.Unknown)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type ScheduleRun = typeof ScheduleRun.Type

/* -------------------------------------------------------------------------- */
