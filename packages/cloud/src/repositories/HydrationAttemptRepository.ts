import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import {
  HYDRATION_BACKOFF_BASE_SECONDS,
  HYDRATION_BACKOFF_CAP_SECONDS,
  HYDRATION_POISON_ATTEMPTS
} from "../services/hydrationBackoff.ts"

export type HydrationTargetKind = "vacancy" | "employer"

export interface HydrationAttemptTarget {
  readonly kind: HydrationTargetKind
  readonly id: string
  readonly externalId: string
}

/**
 * SQL twin of `backoffSeconds`: the same curve, evaluated in the database so
 * the upsert stays one statement. `attempts` is a SQL expression, not a value.
 */
const delayAfter = (attempts: SQL): SQL =>
  sql`(least(
    ${HYDRATION_BACKOFF_BASE_SECONDS}::numeric * power(2::numeric, least(${attempts}, 20)),
    ${HYDRATION_BACKOFF_CAP_SECONDS}::numeric
  ) * interval '1 second')`

/**
 * Queue predicate: a target is selectable unless it failed recently. Reading
 * works for request-scoped users thanks to the read policy on the table.
 */
export const notDeferredSql = (kind: HydrationTargetKind, targetId: SQL): SQL =>
  sql`not exists (
    select 1 from hydration_attempt a
    where a.target_kind = ${kind}
      and a.target_id = ${targetId}
      and a.next_retry_at > now()
  )`

/** Records one failed attempt and moves the retry time further away. */
export const recordFailure = (
  tx: Executor,
  target: HydrationAttemptTarget,
  error: string
): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into hydration_attempt
        (target_kind, target_id, external_id, attempts, last_status, last_error,
         last_attempt_at, next_retry_at)
      values
        (${target.kind}, ${target.id}, ${target.externalId}, 1, 'failed', ${error},
         now(), now() + ${delayAfter(sql`1`)})
      on conflict (target_kind, target_id) do update set
        attempts = hydration_attempt.attempts + 1,
        last_status = 'failed',
        last_error = excluded.last_error,
        last_attempt_at = now(),
        next_retry_at = now() + ${delayAfter(sql`hydration_attempt.attempts + 1`)}
    `)
    .pipe(Effect.asVoid)

/**
 * The page parsed, but the row still looks like a stub (hh returned a short
 * description). Keep the target out of the next few passes without pretending
 * it failed.
 */
export const recordDeferred = (
  tx: Executor,
  target: HydrationAttemptTarget,
  seconds: number,
  note: string
): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into hydration_attempt
        (target_kind, target_id, external_id, attempts, last_status, last_error,
         last_attempt_at, next_retry_at)
      values
        (${target.kind}, ${target.id}, ${target.externalId}, 0, 'ok', ${note},
         now(), now() + (${Math.max(1, Math.floor(seconds))} * interval '1 second'))
      on conflict (target_kind, target_id) do update set
        attempts = 0,
        last_status = 'ok',
        last_error = excluded.last_error,
        last_attempt_at = now(),
        next_retry_at = excluded.next_retry_at
    `)
    .pipe(Effect.asVoid)

/** A good page clears the debt; the target is immediately selectable again. */
export const recordSuccess = (
  tx: Executor,
  target: HydrationAttemptTarget
): RepoEffect<void> =>
  tx
    .execute(sql`
      delete from hydration_attempt
      where target_kind = ${target.kind} and target_id = ${target.id}
    `)
    .pipe(Effect.asVoid)

export interface HydrationAttemptSummary {
  readonly deferredVacancies: number
  readonly deferredEmployers: number
  readonly poisoned: number
  readonly nextRetryAt: string | null
}

/** Operator-facing counters: what is waiting and what keeps failing. */
export const summary = (tx: Executor): RepoEffect<HydrationAttemptSummary> =>
  tx
    .execute(sql`
      select
        count(*) filter (
          where target_kind = 'vacancy' and next_retry_at > now()
        )::int as deferred_vacancies,
        count(*) filter (
          where target_kind = 'employer' and next_retry_at > now()
        )::int as deferred_employers,
        count(*) filter (where attempts >= ${HYDRATION_POISON_ATTEMPTS})::int as poisoned,
        min(next_retry_at) filter (where next_retry_at > now()) as next_retry_at
      from hydration_attempt
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as {
          deferred_vacancies?: number | string
          deferred_employers?: number | string
          poisoned?: number | string
          next_retry_at?: string | Date | null
        } | undefined
        const next = row?.next_retry_at
        const nextDate = next === null || next === undefined ? null : new Date(next)
        return {
          deferredVacancies: Number(row?.deferred_vacancies ?? 0),
          deferredEmployers: Number(row?.deferred_employers ?? 0),
          poisoned: Number(row?.poisoned ?? 0),
          nextRetryAt:
            nextDate === null || Number.isNaN(nextDate.getTime())
              ? null
              : nextDate.toISOString()
        }
      })
    )
