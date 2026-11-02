import type { ScheduleId } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const list = Command.make(
  "list",
  {
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const schedules = yield* api.SchedulesList()

    if (json) {
      yield* Console.log(JSON.stringify(schedules, null, 2))
      return
    }
    if (schedules.length === 0) {
      yield* Console.log("No crawl schedules.")
      return
    }

    yield* Console.log(
      table(
        ["id", "every", "enabled", "last run", "next run", "error", "target"],
        schedules.map((schedule) => [
          shortId(schedule.id),
          `${schedule.intervalMinutes}m`,
          schedule.enabled ? "yes" : "no",
          schedule.lastRunAt === null ? "-" : schedule.lastRunAt.slice(0, 16).replace("T", " "),
          schedule.nextRunAt === null ? "-" : schedule.nextRunAt.slice(0, 16).replace("T", " "),
          schedule.lastError ?? "-",
          schedule.targetId
        ])
      )
    )
  })
).pipe(Command.withDescription("List crawl schedules"))

const upsert = Command.make(
  "upsert",
  {
    target: Flag.String("target").pipe(
      Flag.withDescription("hh.ru search URL, e.g. https://hh.ru/search/vacancy?text=devops&area=1")
    ),
    interval: Flag.Int("interval").pipe(
      Flag.withDescription("Minutes between runs"),
      Flag.withDefault(60)
    ),
    enabled: Flag.Boolean("enabled").pipe(
      Flag.withDescription("Whether the worker should run this schedule"),
      Flag.withDefault(true)
    ),
    id: Flag.String("id").pipe(
      Flag.withDescription("Update an existing schedule"),
      Flag.optional
    )
  },
  Effect.fn(function*({ target, interval, enabled, id }) {
    const api = yield* Api
    const schedule = yield* api.ScheduleUpsert({
      id: Option.getOrUndefined(id) as ScheduleId | undefined,
      targetId: target,
      intervalMinutes: interval,
      enabled
    })
    yield* Console.log(
      `${schedule.id}  every ${schedule.intervalMinutes}m  ${schedule.enabled ? "enabled" : "disabled"}`
    )
  })
).pipe(Command.withDescription("Create or update a crawl schedule"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Schedule id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.ScheduleRemove({ id: id as ScheduleId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Delete a crawl schedule"))

const runNow = Command.make(
  "run-now",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Schedule id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.ScheduleRunNow({ id: id as ScheduleId })
    yield* Console.log(
      `${result.schedule.id}  accepted=${result.accepted}  next run ${result.schedule.nextRunAt ?? "-"}`
    )
  })
).pipe(Command.withDescription("Run a schedule once without waiting for its interval"))

export const scheduleCommand = Command.make("schedule").pipe(
  Command.withSubcommands([list, upsert, remove, runNow]),
  Command.withDescription("Crawl schedules run by the worker")
)
