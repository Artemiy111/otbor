import type { ApiError } from "@otbor/contract"
import { Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRepository from "../repositories/ScheduleRepository.ts"
import * as ScheduleRunRepository from "../repositories/ScheduleRunRepository.ts"
import { withRunHeartbeat } from "./scheduleHeartbeat.ts"
import { ScheduleDispatcher, type ScheduleDispatchResult } from "./ScheduleDispatcher.ts"

export interface ScheduleRunOutcome {
  readonly scheduleId: string
  readonly targetId: string
  readonly kind: string
  readonly ok: boolean
  readonly error: string | null
  readonly result?: ScheduleDispatchResult
  /** Not run: a run of the same kind was still alive. The schedule comes back in a minute. */
  readonly skipped?: true
}

export interface DueScheduleOptions {
  readonly now?: Date
  readonly limit?: number
}

/** How long a deferred schedule waits before it is claimed again. */
const DEFER_SECONDS = 60

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

    const runOne = (schedule: ScheduleRepository.StoredSchedule): Effect.Effect<ScheduleRunOutcome> =>
      Effect.gen(function*() {
      // One live run per kind: a second analysis or hydration pass would only
      // fight the first for the same rows. The schedule returns shortly.
      const busy = yield* database.asOwner((tx) => ScheduleRunRepository.hasLiveRun(tx, schedule.kind)).pipe(
        Effect.catchCause(() => Effect.succeed(false))
      )
      if (busy) {
        yield* database
          .asOwner((tx) => ScheduleRepository.deferNext(tx, schedule.id, DEFER_SECONDS))
          .pipe(Effect.catchCause((cause) => Effect.logError(`schedule ${schedule.id}: could not defer`, cause)))
        yield* Effect.logInfo(`schedule ${schedule.id}: ${schedule.kind} is still running, deferred`)
        return {
          scheduleId: schedule.id,
          targetId: schedule.targetId,
          kind: schedule.kind,
          ok: true,
          error: null,
          skipped: true as const
        } satisfies ScheduleRunOutcome
      }

      const runId = yield* database
        .asOwner((tx) => ScheduleRunRepository.createRun(tx, schedule.id, schedule.kind))
        .pipe(Effect.catchCause((cause) =>
          Effect.logError(`schedule ${schedule.id}: could not create run`, cause).pipe(Effect.as(null))
        ))

      const finishRun = (status: "done" | "error", detail?: Record<string, unknown> | null, error?: string | null) =>
        runId === null
          ? Effect.void
          : database
              .asOwner((tx) => ScheduleRunRepository.finishRun(tx, runId, { status, detail, error }))
              .pipe(Effect.catchCause((cause) =>
                Effect.logError(`schedule ${schedule.id}: could not finish run`, cause)
              ))

      const outcome = yield* withRunHeartbeat(database, runId, dispatcher.run(schedule, { runId: runId ?? undefined })).pipe(
        Effect.matchEffect({
          onFailure: (error: ApiError) =>
            finishRun("error", null, errorMessage(error)).pipe(
              Effect.andThen(recordError(schedule.id, errorMessage(error))),
              Effect.as({
                scheduleId: schedule.id,
                targetId: schedule.targetId,
                kind: schedule.kind,
                ok: false,
                error: errorMessage(error)
              } satisfies ScheduleRunOutcome)
            ),
          onSuccess: (result: ScheduleDispatchResult) =>
            finishRun(
              result.error === null ? "done" : "error",
              result.detail ?? null,
              result.error
            ).pipe(
              Effect.andThen(recordError(schedule.id, result.error)),
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
            yield* finishRun("error", null, "runner crashed")
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

      return outcome
      })

    // Kinds run side by side; inside a kind schedules go one after another.
    const lanes = new Map<string, Array<ScheduleRepository.StoredSchedule>>()
    for (const schedule of due) lanes.set(schedule.kind, [...(lanes.get(schedule.kind) ?? []), schedule])
    const laneOutcomes = yield* Effect.forEach(
      [...lanes.values()],
      (lane) => Effect.forEach(lane, runOne),
      { concurrency: "unbounded" }
    )
    const outcomes = laneOutcomes.flat()

    return outcomes
  })
