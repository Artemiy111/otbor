import type { ScheduleId, SourceSyncKind } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const kinds: ReadonlyArray<SourceSyncKind> = [
  "search",
  "source",
  "vacancy_hydration",
  "employer_hydration",
  "mail_sync",
  "telegram_sync",
  "hh_chat_sync",
  "evaluate",
  "fit",
  "resume_sync",
  "analysis",
  "apply",
  "resume_bump"
]

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
      yield* Console.log("No schedules.")
      return
    }

    yield* Console.log(
      table(
        ["id", "kind", "every", "enabled", "last run", "next run", "error", "target"],
        schedules.map((schedule) => [
          shortId(schedule.id),
          schedule.kind,
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
).pipe(Command.withDescription("List schedules"))

const upsert = Command.make(
  "upsert",
  {
    target: Flag.String("target").pipe(
      Flag.withDescription(
        "hh.ru search URL for search, an account id for mail_sync/telegram_sync/evaluate/resume_bump, or 'global'"
      )
    ),
    kind: Flag.String("kind").pipe(
      Flag.withDescription(`One of: ${kinds.join(", ")}`),
      Flag.withDefault("search")
    ),
    interval: Flag.Int("interval").pipe(
      Flag.withDescription("Minutes between runs (default 60; 245 for resume_bump: hh bumps once per 4 hours)"),
      Flag.optional
    ),
    options: Flag.String("options").pipe(
      Flag.withDescription("Per-kind JSON options, e.g. '{\"limit\":25,\"delayMs\":1000}'"),
      Flag.optional
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
  Effect.fn(function*({ target, kind, interval, options, enabled, id }) {
    const api = yield* Api
    if (!kinds.includes(kind as SourceSyncKind)) {
      yield* Console.error(`unknown schedule kind: ${kind}`)
      process.exitCode = 2
      return
    }

    let parsedOptions: Record<string, unknown> | undefined
    const rawOptions = Option.getOrUndefined(options)
    if (rawOptions !== undefined) {
      try {
        const parsed: unknown = JSON.parse(rawOptions)
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("options must be a JSON object")
        }
        parsedOptions = parsed as Record<string, unknown>
      } catch (error) {
        yield* Console.error(
          `invalid --options: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exitCode = 2
        return
      }
    }

    const schedule = yield* api.ScheduleUpsert({
      id: Option.getOrUndefined(id) as ScheduleId | undefined,
      kind: kind as SourceSyncKind,
      targetId: target,
      intervalMinutes: Option.getOrElse(interval, () => (kind === "resume_bump" ? 245 : 60)),
      enabled,
      options: parsedOptions
    })
    yield* Console.log(
      `${schedule.id}  ${schedule.kind}  every ${schedule.intervalMinutes}m  ${schedule.enabled ? "enabled" : "disabled"}`
    )
  })
).pipe(Command.withDescription("Create or update a schedule"))

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
  Command.withDescription("Schedules run by the worker: crawl, hydration and source sync")
)
