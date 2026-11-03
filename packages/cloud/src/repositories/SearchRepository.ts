import type { CrawlFinishStatus, CrawlRun, VacancyId } from "@otbor/contract"
import { eq, or, desc, sql } from "drizzle-orm"
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
  readonly currentPage: number | null
  readonly pagesTotal: number | null
  readonly pagesDone: number
  readonly found: number
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
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
  currentPage: searchRun.currentPage,
  pagesTotal: searchRun.pagesTotal,
  pagesDone: searchRun.pagesDone,
  found: searchRun.found,
  inserted: searchRun.inserted,
  updated: searchRun.updated,
  skipped: searchRun.skipped,
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
  currentPage: row.currentPage,
  pagesTotal: row.pagesTotal,
  pagesDone: row.pagesDone,
  found: row.found,
  inserted: row.inserted,
  updated: row.updated,
  skipped: row.skipped,
  error: row.error,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null
})

const nonNegativeInt = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

const nonNegativeNullableInt = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : nonNegativeInt(value)

/** A new run starts *at* `startPage`: `next_page` doubles as the resume cursor. */
export const startRunFields = (startPage: number) => ({
  status: "running" as const,
  nextPage: nonNegativeInt(startPage),
  currentPage: nonNegativeInt(startPage),
  pagesTotal: null,
  pagesDone: 0,
  found: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  error: null
})

export interface RunProgress {
  readonly pagesDone: number
  readonly found: number
  readonly nextPage: number
  readonly currentPage?: number | null
  readonly pagesTotal?: number | null
  readonly inserted?: number
  readonly updated?: number
  readonly skipped?: number
}

/**
 * Counters arrive cumulative from the crawl loop. Clamping keeps a malformed
 * or retried report from writing a negative cursor or page count.
 */
export const progressRunFields = (progress: RunProgress) => ({
  status: "running" as const,
  pagesDone: nonNegativeInt(progress.pagesDone),
  found: nonNegativeInt(progress.found),
  nextPage: nonNegativeInt(progress.nextPage),
  ...(progress.currentPage === undefined
    ? {}
    : { currentPage: nonNegativeNullableInt(progress.currentPage) }),
  ...(progress.pagesTotal === undefined
    ? {}
    : { pagesTotal: nonNegativeNullableInt(progress.pagesTotal) }),
  ...(progress.inserted === undefined
    ? {}
    : { inserted: nonNegativeInt(progress.inserted) }),
  ...(progress.updated === undefined
    ? {}
    : { updated: nonNegativeInt(progress.updated) }),
  ...(progress.skipped === undefined
    ? {}
    : { skipped: nonNegativeInt(progress.skipped) })
})

export interface FinishRunInput {
  readonly status: CrawlFinishStatus
  readonly pagesDone: number
  readonly found: number
  readonly nextPage: number
  readonly error?: string | null
  readonly inserted?: number
  readonly updated?: number
  readonly skipped?: number
}

export const finishRunFields = (input: FinishRunInput, finishedAt: Date = new Date()) => ({
  status: input.status,
  pagesDone: nonNegativeInt(input.pagesDone),
  found: nonNegativeInt(input.found),
  nextPage: nonNegativeInt(input.nextPage),
  ...(input.inserted === undefined
    ? {}
    : { inserted: nonNegativeInt(input.inserted) }),
  ...(input.updated === undefined ? {} : { updated: nonNegativeInt(input.updated) }),
  ...(input.skipped === undefined ? {} : { skipped: nonNegativeInt(input.skipped) }),
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

export const listRuns = (
  tx: Executor,
  params: {
    readonly queryId?: string
    readonly url?: string
    readonly limit?: number
    readonly offset?: number
  } = {}
) =>
  Effect.gen(function*() {
    let resolvedQueryId = params.queryId
    if (params.url !== undefined && params.url !== "") {
      const rows = yield* tx
        .select({ id: searchQuery.id })
        .from(searchQuery)
        .where(
          or(
            eq(searchQuery.normalizedUrl, params.url),
            eq(searchQuery.url, params.url)
          )
        )
        .limit(1)
      if (rows.length === 0) {
        return { items: [] as ReadonlyArray<StoredSearchRun>, total: 0 }
      }
      resolvedQueryId = rows[0]!.id
    }

    const whereClause =
      resolvedQueryId !== undefined && resolvedQueryId !== null && resolvedQueryId !== ""
        ? eq(searchRun.queryId, resolvedQueryId)
        : sql`true`

    const limit = Math.max(0, Math.trunc(params.limit ?? 50))
    const offset = Math.max(0, Math.trunc(params.offset ?? 0))

    const items = yield* tx
      .select(runSelection)
      .from(searchRun)
      .innerJoin(searchQuery, eq(searchRun.queryId, searchQuery.id))
      .where(whereClause)
      .orderBy(desc(searchRun.startedAt), desc(searchRun.id))
      .limit(limit)
      .offset(offset)

    const countRows = yield* tx
      .select({ count: sql<number>`count(*)::int` })
      .from(searchRun)
      .where(whereClause)

    const total = Number(countRows[0]?.count ?? 0)
    return {
      items: items as ReadonlyArray<StoredSearchRun>,
      total
    }
  })
