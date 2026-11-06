import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { schedule } from "../../../src/db/tables.ts"
import { CrawlRunner } from "../../../src/services/CrawlRunner.ts"
import { ScheduleService, type ScheduleUpsertInput } from "../../../src/services/ScheduleService.ts"
import { runDueSchedules } from "../../../src/services/ScheduleWorker.ts"
import {
  type LayerOptions,
  runAs,
  runAsFailure,
  runAsWithOptions,
  runAsWithRunner
} from "./layers.ts"
import { ownerTx } from "./seeds.ts"

export const scheduleUpsert = (userId: string, input: ScheduleUpsertInput) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.upsert(input)
    })
  )

export const scheduleUpsertFailure = (userId: string, input: ScheduleUpsertInput) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.upsert(input)
    })
  )

export const schedulesList = (userId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.list()
    })
  )

export const scheduleRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.remove(id)
    })
  )

export const scheduleRunNow = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

export const scheduleRunNowWithRunner = (
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  id: string
) =>
  runAsWithRunner(
    userId,
    runner,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

export const scheduleRunNowFailure = (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const schedules = yield* ScheduleService
      return yield* schedules.runNow(id)
    })
  )

/** Forces a schedule due (or not) without waiting for its interval. */
export const setScheduleNextRun = async (id: string, nextRunAt: Date | null) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .update(schedule)
        .set({ nextRunAt })
        .where(eq(schedule.id, id))
    )
  )
}

/** Owner read of a schedule row, including columns the DTO hides. */
export const findScheduleRow = async (id: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(schedule)
        .where(eq(schedule.id, id))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const scheduleRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(schedule)
        .where(eq(schedule.userId, userId))
        .orderBy(schedule.createdAt)
    )
  )

/** One worker tick with a fake crawler: no live hh.ru traffic. */
export const runDueSchedulesAs = (
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  options: { readonly now?: Date; readonly limit?: number } = {}
) => runAsWithRunner(userId, runner, runDueSchedules(options))

/** One worker tick with fake gateways, for mail/Telegram schedule tests. */
export const runDueSchedulesWithGateways = (
  userId: string,
  layer: LayerOptions,
  options: { readonly now?: Date; readonly limit?: number } = {}
) => runAsWithOptions(userId, layer, runDueSchedules(options))
