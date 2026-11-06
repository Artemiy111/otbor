import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { SourceSyncKind } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { ScheduleId } from "../ids.ts"
import { CrawlSchedule, ScheduleRun } from "../models/index.ts"

/**
 * Schedules are user-owned and run by the worker on their interval.
 * `ScheduleRunNow` only accepts the request: the crawl itself runs in a
 * detached fiber, so the RPC returns before a slow hh.ru page does.
 */
export const SchedulesList = Rpc.make("SchedulesList", {
  success: Schema.Array(CrawlSchedule),
  error: ApiError
})

export const ScheduleUpsert = Rpc.make("ScheduleUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(ScheduleId),
    /** Defaults to `search`; the source kinds dispatch to their own runners. */
    kind: Schema.optional(SourceSyncKind),
    targetId: Schema.String,
    intervalMinutes: Schema.Int,
    enabled: Schema.optional(Schema.Boolean),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }),
  success: CrawlSchedule,
  error: ApiError
})

export const ScheduleRemove = Rpc.make("ScheduleRemove", {
  payload: Schema.Struct({ id: ScheduleId }),
  success: Schema.Struct({ id: ScheduleId, deleted: Schema.Boolean }),
  error: ApiError
})

export const ScheduleRunNow = Rpc.make("ScheduleRunNow", {
  payload: Schema.Struct({ id: ScheduleId }),
  success: Schema.Struct({
    accepted: Schema.Boolean,
    schedule: CrawlSchedule
  }),
  error: ApiError
})

export const ScheduleRunsList = Rpc.make("ScheduleRunsList", {
  payload: Schema.Struct({
    scheduleId: Schema.optional(ScheduleId),
    kind: Schema.optional(SourceSyncKind),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(ScheduleRun),
    total: Schema.Int
  }),
  error: ApiError
})
