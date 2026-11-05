import type { ScheduleRun, SourceSyncKind } from "@otbor/contract"
import { eq, desc, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { scheduleRun } from "../db/tables.ts"

export interface StoredScheduleRun {
  readonly id: string
  readonly scheduleId: string
  readonly kind: string
  readonly status: string
  readonly detail: Record<string, unknown> | null
  readonly error: string | null
  readonly startedAt: Date
  readonly finishedAt: Date | null
}

export const toScheduleRun = (row: StoredScheduleRun): ScheduleRun => ({
  id: row.id as ScheduleRun["id"],
  scheduleId: row.scheduleId as ScheduleRun["scheduleId"],
  kind: row.kind as SourceSyncKind,
  status: row.status as ScheduleRun["status"],
  detail: row.detail ?? null,
  error: row.error ?? null,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null
})

const fromSelect = (row: typeof scheduleRun.$inferSelect): StoredScheduleRun => ({
  id: row.id,
  scheduleId: row.scheduleId,
  kind: row.kind,
  status: row.status,
  detail: (row.detail as Record<string, unknown> | null) ?? null,
  error: row.error,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt
})

export const createRun = (
  tx: Executor,
  scheduleId: string,
  kind: string
): RepoEffect<string> =>
  tx
    .insert(scheduleRun)
    .values({ scheduleId, kind, status: "running", heartbeatAt: new Date() })
    .returning({ id: scheduleRun.id })
    .pipe(Effect.map((rows) => rows[0]!.id))

/** Patches the live detail of a running history row; used for hydration progress. */
export const updateDetail = (
  tx: Executor,
  id: string,
  detail: Record<string, unknown>
): RepoEffect<void> =>
  tx
    .update(scheduleRun)
    .set({ detail, heartbeatAt: new Date() })
    .where(eq(scheduleRun.id, id))
    .pipe(Effect.asVoid)

/** A run with no heartbeat for this long is dead, whatever its status says. */
export const LIVE_RUN_SECONDS = 180

/** Proof of life while a run does work that reports no progress. */
export const heartbeat = (tx: Executor, id: string): RepoEffect<void> =>
  tx
    .update(scheduleRun)
    .set({ heartbeatAt: new Date() })
    .where(sql`${scheduleRun.id} = ${id} and ${scheduleRun.status} = 'running'`)
    .pipe(Effect.asVoid)

/** True when a run of this kind is running and still beating. */
export const hasLiveRun = (tx: Executor, kind: string): RepoEffect<boolean> =>
  tx
    .select({ id: scheduleRun.id })
    .from(scheduleRun)
    .where(
      sql`${scheduleRun.kind} = ${kind} and ${scheduleRun.status} = 'running'
        and coalesce(${scheduleRun.heartbeatAt}, ${scheduleRun.startedAt})
          > now() - (${LIVE_RUN_SECONDS} * interval '1 second')`
    )
    .limit(1)
    .pipe(Effect.map((rows) => rows.length > 0))

export interface FinishRunInput {
  readonly status: "done" | "error"
  readonly detail?: Record<string, unknown> | null
  readonly error?: string | null
}

export const finishRun = (
  tx: Executor,
  id: string,
  input: FinishRunInput
): RepoEffect<void> =>
  tx
    .update(scheduleRun)
    .set({
      status: input.status,
      detail: input.detail === undefined ? undefined : input.detail,
      error:
        input.error === undefined || input.error === null || input.error === ""
          ? null
          : input.error,
      finishedAt: new Date()
    })
    .where(eq(scheduleRun.id, id))
    .pipe(Effect.asVoid)

export const listRuns = (
  tx: Executor,
  params: {
    readonly scheduleId?: string
    readonly kind?: string
    readonly limit?: number
    readonly offset?: number
  } = {}
): RepoEffect<{ readonly items: ReadonlyArray<StoredScheduleRun>; readonly total: number }> =>
  Effect.gen(function*() {
    const conditions: Array<ReturnType<typeof eq>> = []
    if (params.scheduleId) conditions.push(eq(scheduleRun.scheduleId, params.scheduleId))
    if (params.kind) conditions.push(eq(scheduleRun.kind, params.kind))

    const whereClause =
      conditions.length === 0 ? sql`true` : sql.join(conditions.map((c) => c), sql` and `)

    const limit = Math.max(0, Math.trunc(params.limit ?? 50))
    const offset = Math.max(0, Math.trunc(params.offset ?? 0))

    const items = yield* tx
      .select()
      .from(scheduleRun)
      .where(whereClause)
      .orderBy(desc(scheduleRun.startedAt), desc(scheduleRun.id))
      .limit(limit)
      .offset(offset)

    const countRows = yield* tx
      .select({ count: sql<number>`count(*)::int` })
      .from(scheduleRun)
      .where(whereClause)

    const total = Number(countRows[0]?.count ?? 0)
    return {
      items: items.map((row) => fromSelect(row)),
      total
    }
  })