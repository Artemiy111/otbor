import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { LIVE_RUN_SECONDS } from "../repositories/ScheduleRunRepository.ts"
import { nextSequence, reconcileJob, targetFor } from "./jobs.ts"

/**
 * How long a `running` row may exist before we assume the worker died.
 *
 * A full search crawl (100 pages with pauses) and a 200-item hydration pass
 * both legitimately run for tens of minutes, so the threshold has to be above
 * the longest healthy pass; otherwise the sweeper would flag live work.
 */
export const STALE_RUN_MINUTES = 45
export const INTERRUPTED_RUN_MESSAGE = "worker interrupted before completion"

export interface InterruptedRunRecovery {
  readonly scheduleRuns: number
  readonly searchRuns: number
}

/**
 * A dead worker leaves `running` rows behind forever. Those rows are not a
 * successful attempt and must not look like one: scheduled work is marked
 * failed, crawls are stopped with the same reason and both get a finish time.
 */
export const recoverInterruptedRuns = (
  tx: Executor
): Effect.Effect<InterruptedRunRecovery, DatabaseError> =>
  Effect.gen(function*() {
    const scheduleResult = yield* tx.execute(sql`
      update schedule_run
      set status = 'error',
          error = case
            when error is null or btrim(error) = '' then ${INTERRUPTED_RUN_MESSAGE}
            else error
          end,
          detail = coalesce(detail, '{}'::jsonb) || '{"interrupted": true}'::jsonb,
          finished_at = now()
      where status = 'running'
        and coalesce(heartbeat_at, started_at) < now() - (${LIVE_RUN_SECONDS} * interval '1 second')
      returning id, schedule_id
    `)
    // An interrupted pass is retried at the next worker tick instead of waiting for
    // the whole interval. If the retry fails or is interrupted again, the schedule
    // is not pulled forward a second time in a row, so a crashing run cannot loop.
    const interruptedSchedules = scheduleResult.rows.map((row) => (row as { schedule_id: string }).schedule_id)
    if (interruptedSchedules.length > 0) {
      yield* tx.execute(sql`
        update schedule s
        set next_run_at = now()
        where s.id in (${sql.join(interruptedSchedules.map((id) => sql`${id}::uuid`), sql`, `)})
          and s.enabled
          and s.next_run_at > now()
          and not exists (
            select 1 from (
              select detail from schedule_run
              where schedule_id = s.id and status <> 'running'
                and id not in (${sql.join(scheduleResult.rows.map((row) => sql`${(row as { id: string }).id}::uuid`), sql`, `)})
              order by started_at desc limit 1
            ) previous
            where previous.detail->>'interrupted' = 'true'
          )
      `)
    }
    const searchResult = yield* tx.execute(sql`
      update search_run
      set status = 'stopped',
          error = case
            when error is null or btrim(error) = '' then ${INTERRUPTED_RUN_MESSAGE}
            else error
          end,
          finished_at = now()
      where status = 'running'
        and started_at < now() - (${STALE_RUN_MINUTES} * interval '1 minute')
      returning id
    `)
    return {
      scheduleRuns: scheduleResult.rows.length,
      searchRuns: searchResult.rows.length
    }
  })

/**
 * Reclaims jobs whose performer stopped heartbeating.
 *
 * A prepare or reconcile job simply returns to the queue. A submit job does
 * not: the harness may have clicked before it died, so the job becomes
 * `needs_reconcile`, its open attempt is closed as ambiguous, and a reconcile
 * job reads the site. The application stays `submitting`; nothing here can
 * cause a second click.
 */
export const recoverExpiredLeases = (
  tx: Executor
): Effect.Effect<ReadonlyArray<QueueRepository.RecoveredJob>, DatabaseError> =>
  Effect.gen(function*() {
    const recovered = yield* QueueRepository.recoverExpired(tx)

    for (const job of recovered) {
      if (job.stage !== "submit" || job.applicationId === null) continue

      const attemptId = yield* ApplicationRepository.openAttempt(tx, job.applicationId, "submit")
      if (attemptId !== null) {
        yield* ApplicationRepository.finishAttempt(
          tx,
          attemptId,
          { tag: "ambiguous", message: "lease expired during submit; outcome unknown" },
          null
        )
      }

      const application = yield* ApplicationRepository.findAny(tx, job.applicationId)
      const target = application === null ? null : yield* targetFor(tx, application)
      if (target !== null) {
        yield* reconcileJob(tx, {
          ...target,
          sequence: yield* nextSequence(tx, target.applicationId, "reconcile")
        })
      }
    }

    return recovered
  })
