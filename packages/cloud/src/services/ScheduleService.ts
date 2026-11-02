import type { ApiError, CrawlSchedule, ScheduleId } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRepository from "../repositories/ScheduleRepository.ts"
import { CrawlRunner, type CrawlRunnerResult } from "./CrawlRunner.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface ScheduleUpsertInput {
  readonly id?: ScheduleId
  readonly targetId: string
  readonly intervalMinutes: number
  readonly enabled?: boolean
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
}

const errorMessage = (error: ApiError): string =>
  "message" in error && typeof error.message === "string" ? error.message : error._tag

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
      const runner = yield* CrawlRunner

      const list: ScheduleServiceShape["list"] = () =>
        database
          .asUser(currentUser.userId, (tx) =>
            ScheduleRepository.list(tx, currentUser.userId)
          )
          .pipe(Effect.mapError(toStorageError("schedule.list")))

      const upsert: ScheduleServiceShape["upsert"] = (input) =>
        Effect.gen(function*() {
          const targetId = input.targetId.trim()
          if (targetId === "") {
            return yield* new InvalidInput({ message: "schedule target must not be empty" })
          }
          if (!/^https?:\/\//i.test(targetId)) {
            return yield* new InvalidInput({
              message: "schedule target must be an http(s) search URL"
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
                targetId,
                intervalMinutes: input.intervalMinutes,
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

          const finished = yield* runner.run({
            userId: currentUser.userId,
            url: schedule.targetId,
            maxPages: 1
          }).pipe(
            Effect.matchEffect({
              onFailure: (error) => recordResult(schedule.id, errorMessage(error)),
              onSuccess: (result: CrawlRunnerResult) =>
                recordResult(schedule.id, result.error)
            }),
            Effect.catchCause((cause) =>
              Effect.logError(`schedule ${schedule.id}: crawl crashed`, cause)
            )
          )

          return finished
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

      return ScheduleService.of({ list, upsert, remove, runNow })
    })
  )
}
