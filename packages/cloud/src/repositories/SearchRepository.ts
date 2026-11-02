import type { CrawlFinishStatus, CrawlRun, VacancyId } from "@otbor/contract"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor } from "../db/Database.ts"
import { searchQuery, searchRun, vacancySearchHit } from "../db/tables.ts"

/**
 * `search_query` is the saved search, `search_run` one attempt at it and
 * `vacancy_search_hit` the link between a query and the vacancies it found.
 * The crawler never writes these directly: it calls the crawl RPCs, which land
 * here through the owner role.
 */

export interface StoredSearchRun {
  readonly id: string
  readonly queryId: string
  readonly normalizedUrl: string
  readonly status: string
  readonly nextPage: number | null
  readonly pagesDone: number
  readonly found: number
  readonly error: string | null
  readonly startedAt: Date
  readonly finishedAt: Date | null
}

const runSelection = {
  id: searchRun.id,
  queryId: searchRun.queryId,
  normalizedUrl: searchQuery.normalizedUrl,
  status: searchRun.status,
  nextPage: searchRun.nextPage,
  pagesDone: searchRun.pagesDone,
  found: searchRun.found,
  error: searchRun.error,
  startedAt: searchRun.startedAt,
  finishedAt: searchRun.finishedAt
}

export const toCrawlRun = (row: StoredSearchRun): CrawlRun => ({
  runId: row.id as CrawlRun["runId"],
  queryId: row.queryId as CrawlRun["queryId"],
  normalizedUrl: row.normalizedUrl,
  status: row.status as CrawlRun["status"],
  nextPage: row.nextPage ?? 0,
  pagesDone: row.pagesDone,
  found: row.found,
  error: row.error,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null
})

const nonNegativeInt = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

/** A new run starts *at* `startPage`: `next_page` doubles as the resume cursor. */
export const startRunFields = (startPage: number) => ({
  status: "running" as const,
  nextPage: nonNegativeInt(startPage),
  pagesDone: 0,
  found: 0,
  error: null
})

export interface RunProgress {
  readonly pagesDone: number
  readonly found: number
  readonly nextPage: number
}

/**
 * Counters arrive cumulative from the crawl loop. Clamping keeps a malformed
 * or retried report from writing a negative cursor or page count.
 */
export const progressRunFields = (progress: RunProgress) => ({
  status: "running" as const,
  pagesDone: nonNegativeInt(progress.pagesDone),
  found: nonNegativeInt(progress.found),
  nextPage: nonNegativeInt(progress.nextPage)
})

export interface FinishRunInput {
  readonly status: CrawlFinishStatus
  readonly pagesDone: number
  readonly found: number
  readonly nextPage: number
  readonly error?: string | null
}

export const finishRunFields = (input: FinishRunInput, finishedAt: Date = new Date()) => ({
  status: input.status,
  pagesDone: nonNegativeInt(input.pagesDone),
  found: nonNegativeInt(input.found),
  nextPage: nonNegativeInt(input.nextPage),
  error: input.error === undefined || input.error === null || input.error === ""
    ? null
    : input.error,
  finishedAt
})

/**
 * Hit rows for one page. Duplicate cards are collapsed: the primary key is
 * (query_id, vacancy_id), and the position is the first card position.
 */
export const searchHitRows = (
  queryId: string,
  vacancyIds: ReadonlyArray<VacancyId | string>
) => {
  const seen = new Set<string>()
  const rows: Array<{ queryId: string; vacancyId: string; position: number }> = []

  for (const vacancyId of vacancyIds) {
    const id = String(vacancyId)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({ queryId, vacancyId: id, position: rows.length })
  }

  return rows
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface UpsertQueryInput {
  readonly url: string
  readonly normalizedUrl: string
  readonly title: string | null
  readonly textQuery: string | null
}

export const upsertQuery = (tx: Executor, input: UpsertQueryInput) =>
  tx
    .insert(searchQuery)
    .values({
      url: input.url,
      normalizedUrl: input.normalizedUrl,
      title: input.title,
      textQuery: input.textQuery
    })
    .onConflictDoUpdate({
      target: searchQuery.normalizedUrl,
      set: {
        url: input.url,
        title: input.title,
        textQuery: input.textQuery
      }
    })
    .returning({ id: searchQuery.id })

export const createRun = (tx: Executor, queryId: string, startPage: number) =>
  tx
    .insert(searchRun)
    .values({ queryId, ...startRunFields(startPage) })
    .returning({ id: searchRun.id })

export const updateRunProgress = (tx: Executor, runId: string, progress: RunProgress) =>
  tx
    .update(searchRun)
    .set(progressRunFields(progress))
    .where(eq(searchRun.id, runId))

export const insertHits = (
  tx: Executor,
  rows: ReadonlyArray<{ queryId: string; vacancyId: string; position: number }>
) =>
  rows.length === 0
    ? Effect.void
    : tx.insert(vacancySearchHit).values([...rows]).onConflictDoNothing().pipe(Effect.asVoid)

export const finishRun = (
  tx: Executor,
  runId: string,
  input: FinishRunInput,
  finishedAt: Date = new Date()
) =>
  tx
    .update(searchRun)
    .set(finishRunFields(input, finishedAt))
    .where(eq(searchRun.id, runId))

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export const findRun = (tx: Executor, runId: string) =>
  tx
    .select(runSelection)
    .from(searchRun)
    .innerJoin(searchQuery, eq(searchRun.queryId, searchQuery.id))
    .where(eq(searchRun.id, runId))
    .limit(1)
    .pipe(Effect.map((rows) => rows[0] ?? null))
