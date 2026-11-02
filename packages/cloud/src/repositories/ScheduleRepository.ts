import type { CrawlSchedule } from "@otbor/contract"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { schedule } from "../db/tables.ts"

/**
 * `schedule` is the recurring form of a saved search. The worker claims due
 * rows with `FOR UPDATE SKIP LOCKED`, so two workers never run the same
 * interval, and a slow crawl does not block the rest of the table.
 */

export interface StoredSchedule {
  readonly id: string
  readonly userId: string
  readonly kind: string
  readonly targetId: string
  readonly intervalMinutes: number
  readonly options: Record<string, unknown>
  readonly enabled: boolean
  readonly nextRunAt: Date | null
  readonly lastRunAt: Date | null
  readonly lastError: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export const toCrawlSchedule = (row: StoredSchedule): CrawlSchedule => ({
  id: row.id as CrawlSchedule["id"],
  kind: row.kind as CrawlSchedule["kind"],
  targetId: row.targetId,
  intervalMinutes: row.intervalMinutes,
  options: row.options,
  enabled: row.enabled,
  nextRunAt: row.nextRunAt?.toISOString() ?? null,
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
  lastError: row.lastError,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
})

const fromSelect = (row: typeof schedule.$inferSelect): StoredSchedule => ({
  id: row.id,
  userId: row.userId ?? "",
  kind: row.kind,
  targetId: row.targetId,
  intervalMinutes: row.intervalMinutes,
  options: row.options,
  enabled: row.enabled,
  nextRunAt: row.nextRunAt,
  lastRunAt: row.lastRunAt,
  lastError: row.lastError,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

/** Raw SQL returns snake_case columns, as with the queue repository. */
const fromRaw = (row: Record<string, unknown>): StoredSchedule => ({
  id: String(row.id),
  userId: String(row.user_id ?? ""),
  kind: String(row.kind),
  targetId: String(row.target_id),
  intervalMinutes: Number(row.interval_minutes),
  options: (row.options as Record<string, unknown> | null) ?? {},
  enabled: row.enabled === true,
  nextRunAt: (row.next_run_at as Date | null) ?? null,
  lastRunAt: (row.last_run_at as Date | null) ?? null,
  lastError: (row.last_error as string | null) ?? null,
  createdAt: row.created_at as Date,
  updatedAt: row.updated_at as Date
})

const minutes = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

export const list = (tx: Executor, userId: string): RepoEffect<ReadonlyArray<CrawlSchedule>> =>
  tx
    .select()
    .from(schedule)
    .where(eq(schedule.userId, userId))
    .orderBy(sql`${schedule.createdAt} desc`)
    .pipe(Effect.map((rows) => rows.map((row) => toCrawlSchedule(fromSelect(row)))))

export const find = (
  tx: Executor,
  id: string,
  userId: string
): RepoEffect<CrawlSchedule | null> =>
  tx
    .select()
    .from(schedule)
    .where(sql`${schedule.id} = ${id} and ${schedule.userId} = ${userId}`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined ? null : toCrawlSchedule(fromSelect(rows[0]))
      )
    )

export const findStored = (
  tx: Executor,
  id: string,
  userId: string
): RepoEffect<StoredSchedule | null> =>
  tx
    .select()
    .from(schedule)
    .where(sql`${schedule.id} = ${id} and ${schedule.userId} = ${userId}`)
    .limit(1)
    .pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : fromSelect(rows[0])))
    )

export interface UpsertScheduleInput {
  readonly userId: string
  readonly id?: string | null
  readonly kind: string
  readonly targetId: string
  readonly intervalMinutes: number
  readonly options?: Record<string, unknown>
  readonly enabled: boolean
  readonly now?: Date
}

/**
 * Creating or enabling a schedule makes it due immediately; the interval is
 * then counted from the claimed run. Editing a live schedule leaves its next
 * run untouched so saving a typo does not postpone the crawl by an hour.
 */
export const upsert = (
  tx: Executor,
  input: UpsertScheduleInput
): RepoEffect<CrawlSchedule> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()

    if (input.id !== null && input.id !== undefined) {
      const [existing] = yield* tx
        .select()
        .from(schedule)
        .where(sql`${schedule.id} = ${input.id} and ${schedule.userId} = ${input.userId}`)
        .limit(1)

      if (existing !== undefined) {
        const nextRunAt = input.enabled ? existing.nextRunAt ?? now : null
        const [row] = yield* tx
          .update(schedule)
          .set({
            kind: input.kind,
            targetId: input.targetId,
            intervalMinutes: minutes(input.intervalMinutes),
            options: input.options ?? existing.options,
            enabled: input.enabled,
            nextRunAt,
            lastError: input.enabled && existing.enabled ? existing.lastError : null,
            updatedAt: now
          })
          .where(sql`${schedule.id} = ${existing.id}`)
          .returning()
        return toCrawlSchedule(fromSelect(row!))
      }
    }

    const [row] = yield* tx
      .insert(schedule)
      .values({
        userId: input.userId,
        kind: input.kind,
        targetId: input.targetId,
        intervalMinutes: minutes(input.intervalMinutes),
        options: input.options ?? {},
        enabled: input.enabled,
        nextRunAt: input.enabled ? now : null,
        lastError: null
      })
      .returning()

    return toCrawlSchedule(fromSelect(row!))
  })

export const remove = (
  tx: Executor,
  id: string,
  userId: string
): RepoEffect<boolean> =>
  tx
    .delete(schedule)
    .where(sql`${schedule.id} = ${id} and ${schedule.userId} = ${userId}`)
    .returning({ id: schedule.id })
    .pipe(Effect.map((rows) => rows.length > 0))

export interface DueOptions {
  readonly now?: Date
  readonly limit?: number
}

/**
 * Due schedules, locked for the caller's transaction. Every kind with an owner
 * is dispatchable; system rows (`user_id is null`) are not.
 */
export const due = (
  tx: Executor,
  options: DueOptions = {}
): RepoEffect<ReadonlyArray<StoredSchedule>> => {
  const now = options.now ?? new Date()
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100)

  return tx
    .execute(sql`
      select *
      from schedule
      where enabled
        and user_id is not null
        and next_run_at is not null
        and next_run_at <= ${now}
      order by next_run_at asc
      for update skip locked
      limit ${limit}
    `)
    .pipe(Effect.map((result) => result.rows.map((row) => fromRaw(row))))
}

export interface MarkRunInput {
  readonly lastRunAt: Date
  readonly nextRunAt: Date
}

/** Records the claim before the crawl starts, so a crash cannot double-run it. */
export const markRun = (
  tx: Executor,
  id: string,
  input: MarkRunInput
): RepoEffect<void> =>
  tx
    .update(schedule)
    .set({
      lastRunAt: input.lastRunAt,
      nextRunAt: input.nextRunAt,
      lastError: null,
      updatedAt: input.lastRunAt
    })
    .where(eq(schedule.id, id))
    .pipe(Effect.asVoid)

/**
 * Selects due schedules and advances them in the same transaction. The crawl
 * happens after the transaction commits; `next_run_at` is already in the
 * future, so another worker can claim a different row immediately.
 */
export const claimDue = (
  tx: Executor,
  options: DueOptions = {}
): RepoEffect<ReadonlyArray<StoredSchedule>> =>
  Effect.gen(function*() {
    const now = options.now ?? new Date()
    const rows = yield* due(tx, { ...options, now })
    const claimed: Array<StoredSchedule> = []

    for (const row of rows) {
      const nextRunAt = new Date(now.getTime() + minutes(row.intervalMinutes) * 60_000)
      yield* markRun(tx, row.id, { lastRunAt: now, nextRunAt })
      claimed.push({ ...row, lastRunAt: now, nextRunAt, lastError: null })
    }

    return claimed
  })

export const setError = (
  tx: Executor,
  id: string,
  error: string | null
): RepoEffect<void> =>
  tx
    .update(schedule)
    .set({ lastError: error, updatedAt: new Date() })
    .where(eq(schedule.id, id))
    .pipe(Effect.asVoid)
