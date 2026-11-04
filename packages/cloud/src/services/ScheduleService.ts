import type { ApiError, CrawlSchedule, ScheduleId, ScheduleRun, SourceSyncKind } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRepository from "../repositories/ScheduleRepository.ts"
import * as ScheduleRunRepository from "../repositories/ScheduleRunRepository.ts"
import { ScheduleDispatcher } from "./ScheduleDispatcher.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ScheduleUpsertInput {
  readonly id?: ScheduleId
  readonly kind?: SourceSyncKind
  readonly targetId: string
  readonly intervalMinutes: number
  readonly enabled?: boolean
  readonly options?: Record<string, unknown>
}

export interface ScheduleRunNowResult {
  readonly accepted: boolean
  readonly schedule: CrawlSchedule
}

export interface ScheduleServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<CrawlSchedule>, ApiError>
  readonly upsert: (input: ScheduleUpsertInput) => Effect.Effect<CrawlSchedule, ApiError>
  readonly remove: (
    id: string
  ) => Effect.Effect<{ readonly id: ScheduleId; readonly deleted: boolean }, ApiError>
  readonly runNow: (id: string) => Effect.Effect<ScheduleRunNowResult, ApiError>
  readonly runs: (params: {
    readonly scheduleId?: ScheduleId
    readonly kind?: SourceSyncKind
    readonly limit?: number
    readonly offset?: number
  }) => Effect.Effect<{ readonly items: ReadonlyArray<ScheduleRun>; readonly total: number }, ApiError>
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
 * User-owned crawl schedules. `runNow` only records the claim and starts a
 * detached fiber: hh.ru can take tens of seconds, and an operator UI must not
 * hold an RPC open for that.
 */
export class ScheduleService extends Context.Service<ScheduleService, ScheduleServiceShape>()(
  "otbor/cloud/ScheduleService"
) {
  static readonly layer = Layer.effect(
    ScheduleService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const dispatcher = yield* ScheduleDispatcher

      const list: ScheduleServiceShape["list"] = () =>
        database
          .asUser(currentUser.userId, (tx) =>
            ScheduleRepository.list(tx, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("schedule.list")))

      const upsert: ScheduleServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const kind = input.kind ?? "search"
          const targetId = input.targetId.trim()
          if (targetId === "") {
            return yield* new InvalidInput({ message: "schedule target must not be empty" })
          }
          if (kind === "search" && !/^https?:\/\//i.test(targetId)) {
            return yield* new InvalidInput({
              message: "schedule target must be an http(s) search URL"
            })
          }
          if (kind !== "search" && kind !== "source" && /^https?:\/\//i.test(targetId)) {
            return yield* new InvalidInput({
              message: `${kind} schedule target must be an account id, not a URL`
            })
          }
          if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1) {
            return yield* new InvalidInput({
              message: "schedule interval must be a positive number of minutes"
            })
          }

          return yield* database
            .asUser(currentUser.userId, (tx) =>
              ScheduleRepository.upsert(tx, {
                userId: currentUser.userId,
                id: input.id ?? null,
                kind,
                targetId,
                intervalMinutes: input.intervalMinutes,
                options: input.options,
                enabled: input.enabled ?? true
              })
            )
            .pipe(Effect.mapError(toStorageError("schedule.upsert")))
        })

      const remove: ScheduleServiceShape["remove"] = (id) =>
        Effect.gen(function*() {
          const deleted = yield* database
            .asUser(currentUser.userId, (tx) =>
              ScheduleRepository.remove(tx, id, currentUser.userId)
            )
            .pipe(Effect.mapError(toStorageError("schedule.remove")))

          return { id: id as ScheduleId, deleted }
        })

      /** Never lets a crawl failure escape into the detached fiber's parent. */
      const recordResult = (scheduleId: string, error: string | null) =>
        database
          .asOwner((tx) => ScheduleRepository.setError(tx, scheduleId, error))
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logError(`schedule ${scheduleId}: could not record result`, cause)
            )
          )

      const startRun = (schedule: CrawlSchedule) =>
        Effect.gen(function*() {
          yield* Effect.logInfo(`schedule ${schedule.id}: manual run accepted`)

          const stored = yield* database
            .asOwner((tx) =>
              ScheduleRepository.findStored(tx, schedule.id, currentUser.userId)
            )
            .pipe(Effect.mapError(toStorageError("schedule.runNow")))

          if (stored === null) return

          const runId = yield* database
            .asOwner((tx) => ScheduleRunRepository.createRun(tx, schedule.id, schedule.kind))
            .pipe(Effect.catchCause((cause) => Effect.logError(`schedule ${schedule.id}: could not create run`, cause).pipe(Effect.as(null))))

          const finishRun = (status: "done" | "error", detail?: Record<string, unknown> | null, error?: string | null) =>
            runId === null
              ? Effect.void
              : database
                  .asOwner((tx) =>
                    ScheduleRunRepository.finishRun(tx, runId, { status, detail, error })
                  )
                  .pipe(Effect.catchCause((cause) =>
                    Effect.logError(`schedule ${schedule.id}: could not finish run`, cause)
                  ))

          yield* dispatcher.run(stored, { runId: runId ?? undefined }).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                finishRun("error", null, errorMessage(error)).pipe(
                  Effect.andThen(recordResult(schedule.id, errorMessage(error)))
                ),
              onSuccess: (result) =>
                finishRun(
                  result.error === null ? "done" : "error",
                  result.detail ?? null,
                  result.error
                ).pipe(Effect.andThen(recordResult(schedule.id, result.error)))
            }),
            Effect.catchCause((cause) =>
              Effect.gen(function*() {
                yield* Effect.logError(`schedule ${schedule.id}: runner crashed`, cause)
                yield* finishRun("error", null, "runner crashed")
                yield* recordResult(schedule.id, "runner crashed")
              })
            )
          )
        })

      const runNow: ScheduleServiceShape["runNow"] = (id) =>
        Effect.gen(function*() {
          const existing = yield* database
            .asUser(currentUser.userId, (tx) =>
              ScheduleRepository.find(tx, id, currentUser.userId)
            )
            .pipe(Effect.mapError(toStorageError("schedule.runNow")))

          if (existing === null) {
            return yield* new NotFound({ entity: "Schedule", id })
          }

          const now = new Date()
          const nextRunAt = new Date(
            now.getTime() + Math.max(1, existing.intervalMinutes) * 60_000
          )

          const updated = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                yield* ScheduleRepository.markRun(tx, id, {
                  lastRunAt: now,
                  nextRunAt
                })
                return yield* ScheduleRepository.find(tx, id, currentUser.userId)
              })
            )
            .pipe(Effect.mapError(toStorageError("schedule.runNow")))

          if (updated === null) {
            return yield* new NotFound({ entity: "Schedule", id })
          }

          yield* startRun(updated).pipe(Effect.forkDetach)
          return { accepted: true, schedule: updated }
        })

      const runs: ScheduleServiceShape["runs"] = (params) =>
        database
          .asUser(currentUser.userId, (tx) =>
            Effect.gen(function*() {
              const result = yield* ScheduleRunRepository.listRuns(tx, {
                scheduleId: params.scheduleId,
                kind: params.kind,
                limit: params.limit,
                offset: params.offset
              })
              return {
                items: result.items.map((row) => ScheduleRunRepository.toScheduleRun(row)),
                total: result.total
              }
            })
          )
          .pipe(Effect.mapError(toStorageError("schedule.runs")))

      return ScheduleService.of({ list, upsert, remove, runNow, runs })
    })
  )
}
