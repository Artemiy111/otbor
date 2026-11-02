import type { ApiError } from "@otbor/contract"
import { Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRepository from "../repositories/ScheduleRepository.ts"
import { ScheduleDispatcher, type ScheduleDispatchResult } from "./ScheduleDispatcher.ts"

export interface ScheduleRunOutcome {
  readonly scheduleId: string
  readonly targetId: string
  readonly kind: string
  readonly ok: boolean
  readonly error: string | null
  readonly result?: ScheduleDispatchResult
}

export interface DueScheduleOptions {
  readonly now?: Date
  readonly limit?: number
}

const errorMessage = (error: ApiError): string => {
  if (error._tag === "NotFound") return `${error.entity} not found: ${error.id}`
  if (error._tag === "Conflict") return `${error.entity}: ${error.message}`
  if ("message" in error && typeof error.message === "string" && error.message.trim() !== "") {
    return error.message
  }
  return error._tag
}

/**
 * One worker tick: claim due schedules and run them one at a time.
 *
 * Claiming uses the owner connection with `FOR UPDATE SKIP LOCKED`, and
 * `next_run_at` is advanced in the same transaction, so a second worker
 * process cannot pick up the same interval and a crash cannot replay it.
 * Each kind is isolated: a failure is written to `last_error` and the loop
 * continues with the next schedule.
 */
export const runDueSchedules = (
  options: DueScheduleOptions = {}
): Effect.Effect<
  ReadonlyArray<ScheduleRunOutcome>,
  never,
  Database | ScheduleDispatcher
> =>
  Effect.gen(function*() {
    const database = yield* Database
    const dispatcher = yield* ScheduleDispatcher

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
      const outcome = yield* dispatcher.run(schedule).pipe(
        Effect.matchEffect({
          onFailure: (error: ApiError) =>
            recordError(schedule.id, errorMessage(error)).pipe(
              Effect.as({
                scheduleId: schedule.id,
                targetId: schedule.targetId,
                kind: schedule.kind,
                ok: false,
                error: errorMessage(error)
              } satisfies ScheduleRunOutcome)
            ),
          onSuccess: (result: ScheduleDispatchResult) =>
            recordError(schedule.id, result.error).pipe(
              Effect.as({
                scheduleId: schedule.id,
                targetId: schedule.targetId,
                kind: schedule.kind,
                ok: result.ok,
                error: result.error,
                result
              } satisfies ScheduleRunOutcome)
            )
        }),
        // A defect must not stop the remaining schedules either.
        Effect.catchCause((cause) =>
          Effect.gen(function*() {
            yield* Effect.logError(`schedule ${schedule.id}: runner crashed`, cause)
            yield* recordError(schedule.id, "runner crashed")
            return {
              scheduleId: schedule.id,
              targetId: schedule.targetId,
              kind: schedule.kind,
              ok: false,
              error: "runner crashed"
            } satisfies ScheduleRunOutcome
          })
        )
      )

      outcomes.push(outcome)
    }

    return outcomes
  })
