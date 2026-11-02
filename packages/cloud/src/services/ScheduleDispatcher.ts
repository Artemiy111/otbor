import type { ApiError } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import type { StoredSchedule } from "../repositories/ScheduleRepository.ts"
import { CrawlRunner, type CrawlRunnerResult } from "./CrawlRunner.ts"
import { EmployerHydrator } from "./EmployerHydrator.ts"
import { HydrationRunner } from "./HydrationRunner.ts"
import { MailSync } from "./MailSync.ts"
import { TelegramSync } from "./TelegramSync.ts"

export interface ScheduleDispatchResult {
  readonly ok: boolean
  readonly error: string | null
  readonly detail?: Record<string, unknown>
}

export interface ScheduleDispatcherShape {
  /** Runs exactly one bounded pass for a claimed schedule row. */
  readonly run: (schedule: StoredSchedule) => Effect.Effect<ScheduleDispatchResult, ApiError>
}

const intOption = (
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number => {
  const value = options[key]
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

const searchResult = (result: CrawlRunnerResult): ScheduleDispatchResult => ({
  ok: result.error === null,
  error: result.error,
  detail: {
    runId: result.runId,
    status: result.status,
    pagesDone: result.pagesDone,
    found: result.found,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped
  }
})

const syncResult = (result: {
  processed: number
  inserted: number
  updated: number
  skipped: number
  contacts: number
  linked: number
  errors: ReadonlyArray<string>
}): ScheduleDispatchResult => ({
  ok: result.errors.length === 0,
  error: result.errors.length === 0 ? null : result.errors.join("; "),
  detail: {
    processed: result.processed,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    contacts: result.contacts,
    linked: result.linked
  }
})

/**
 * Every schedule kind in one place. The worker and `ScheduleRunNow` both call
 * this, so a manual run and an interval run cannot diverge.
 */
export class ScheduleDispatcher extends Context.Service<
  ScheduleDispatcher,
  ScheduleDispatcherShape
>()("otbor/cloud/ScheduleDispatcher") {
  static readonly layer = Layer.effect(
    ScheduleDispatcher,
    Effect.gen(function*() {
      const runner = yield* CrawlRunner
      const hydration = yield* HydrationRunner
      const employers = yield* EmployerHydrator
      const mail = yield* MailSync
      const telegram = yield* TelegramSync

      const run: ScheduleDispatcherShape["run"] = (schedule) =>
        Effect.gen(function*() {
          const options = schedule.options ?? {}

          switch (schedule.kind) {
            case "search":
            case "source": {
              if (!/^https?:\/\//i.test(schedule.targetId)) {
                return yield* new InvalidInput({
                  message: `schedule ${schedule.id}: ${schedule.kind} target must be an http(s) URL`
                })
              }
              const result = yield* runner.run({
                userId: schedule.userId,
                url: schedule.targetId,
                maxPages: 1
              })
              return searchResult(result)
            }

            case "vacancy_hydration": {
              const result = yield* hydration.run(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                delayMs: intOption(options, "delayMs", 1000, 0, 60_000)
              })
              const error =
                result.errors.length === 0 ? null : result.errors.join("; ")
              return {
                ok: error === null,
                error,
                detail: {
                  processed: result.processed,
                  hydrated: result.hydrated,
                  failed: result.failed,
                  inserted: result.inserted,
                  updated: result.updated,
                  skipped: result.skipped
                }
              }
            }

            case "employer_hydration": {
              const result = yield* employers.run(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                delayMs: intOption(options, "delayMs", 750, 0, 60_000)
              })
              const error =
                result.errors.length === 0 ? null : result.errors.join("; ")
              return {
                ok: error === null,
                error,
                detail: {
                  processed: result.processed,
                  updated: result.updated,
                  failed: result.failed
                }
              }
            }

            case "mail_sync": {
              if (schedule.targetId.trim() === "") {
                return yield* new InvalidInput({
                  message: `schedule ${schedule.id}: mail_sync needs a mail account id`
                })
              }
              const hasDays = Object.prototype.hasOwnProperty.call(options, "days")
              const days = hasDays
                ? intOption(options, "days", 0, 0, 3_650)
                : undefined
              const result = yield* mail.sync(schedule.userId, schedule.targetId, {
                limit: intOption(options, "limit", 100, 1, 500),
                maxPages: intOption(options, "maxPages", 10, 1, 100),
                               ...(days === undefined ? {} : { days })
              })
              return syncResult(result)
            }

            case "telegram_sync": {
              if (schedule.targetId.trim() === "") {
                return yield* new InvalidInput({
                  message: `schedule ${schedule.id}: telegram_sync needs a telegram account id`
                })
              }
              const result = yield* telegram.sync(schedule.userId, schedule.targetId, {
                dialogs: intOption(options, "dialogs", 25, 1, 100),
                messages: intOption(options, "messages", 50, 1, 200)
              })
              return syncResult(result)
            }

            case "hh_chat_sync":
              return yield* new InvalidInput({
                message:
                  "hh chat sync requires the browser harness; it is not implemented yet"
              })

            default:
              return yield* new InvalidInput({
                message: `schedule ${schedule.id}: unknown kind ${schedule.kind}`
              })
          }
        })

      return ScheduleDispatcher.of({ run })
    })
  )
}
