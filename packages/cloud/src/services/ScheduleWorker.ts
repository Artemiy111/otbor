import type { ApiError } from "@otbor/contract"
import { Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRepository from "../repositories/ScheduleRepository.ts"
import { CrawlRunner, type CrawlRunnerResult } from "./CrawlRunner.ts"

export interface ScheduleRunOutcome {
  readonly scheduleId: string
  readonly targetId: string
  readonly ok: boolean
  readonly error: string | null
  readonly result?: CrawlRunnerResult
}

export interface DueScheduleOptions {
  readonly now?: Date
  readonly limit?: number
}

const errorMessage = (error: ApiError): string =>
  "message" in error && typeof error.message === "string" ? error.message : error._tag

/**
 * One worker tick: claim due schedules and run them one at a time.
 *
 * Claiming uses the owner connection with `FOR UPDATE SKIP LOCKED`, and
 * `next_run_at` is advanced in the same transaction, so a second worker
 * process cannot pick up the same interval and a crash cannot replay it.
 * Each crawl is isolated: a failure is written to `last_error` and the loop
 * continues with the next schedule.
 */
export const runDueSchedules = (
  options: DueScheduleOptions = {}
): Effect.Effect<
  ReadonlyArray<ScheduleRunOutcome>,
  never,
  Database | CrawlRunner
> =>
  Effect.gen(function*() {
    const database = yield* Database
    const runner = yield* CrawlRunner

    const recordError = (scheduleId: string, error: string | null) =>
      database
        .asOwner((tx) => ScheduleRepository.setError(tx, scheduleId, error))
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`schedule ${scheduleId}: could not record result`, cause)
          )
        )

    const due = yield* database.asOwner((tx) => ScheduleRepository.claimDue(tx, options)).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("could not claim due schedules", cause).pipe(
          Effect.as([] as ReadonlyArray<ScheduleRepository.StoredSchedule>)
        )
      )
    )

    if (due.length === 0) return []

    yield* Effect.logInfo(`Running ${due.length} due schedule(s)`)

    const outcomes: Array<ScheduleRunOutcome> = []

    for (const schedule of due) {
      const outcome = yield* runner
        .run({
          userId: schedule.userId,
          url: schedule.targetId,
          maxPages: 1
        })
        .pipe(
          Effect.matchEffect({
            onFailure: (error: ApiError) =>
              recordError(schedule.id, errorMessage(error)).pipe(
                Effect.as({
                  scheduleId: schedule.id,
                  targetId: schedule.targetId,
                  ok: false,
                  error: errorMessage(error)
                } satisfies ScheduleRunOutcome)
              ),
            onSuccess: (result: CrawlRunnerResult) =>
              recordError(schedule.id, result.error).pipe(
                Effect.as({
                  scheduleId: schedule.id,
                  targetId: schedule.targetId,
                  ok: result.error === null,
                  error: result.error,
                  result
                } satisfies ScheduleRunOutcome)
              )
          }),
          // A defect must not stop the remaining schedules either.
          Effect.catchCause((cause) =>
            Effect.gen(function*() {
              yield* Effect.logError(`schedule ${schedule.id}: crawl crashed`, cause)
              yield* recordError(schedule.id, "crawl crashed")
              return {
                scheduleId: schedule.id,
                targetId: schedule.targetId,
                ok: false,
                error: "crawl crashed"
              } satisfies ScheduleRunOutcome
            })
          )
        )

      outcomes.push(outcome)
    }

    return outcomes
  })
