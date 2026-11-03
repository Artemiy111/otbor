import type { ApiError, PresetId, ResumeId } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import { Cause, Context, Effect, Layer } from "effect"
import type { StoredSchedule } from "../repositories/ScheduleRepository.ts"
import { CrawlRunner, type CrawlRunnerResult } from "./CrawlRunner.ts"
import { DEFAULT_BATCH, MAX_BATCH } from "./decisionEvaluation.ts"
import { EmployerHydrator } from "./EmployerHydrator.ts"
import { EvaluationRunner } from "./EvaluationRunner.ts"
import { FitJudgeRunner } from "./FitJudgeRunner.ts"
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

/** Hard cap on pages per scheduled crawl tick. */
export const MAX_CRAWL_PAGES = 100
/**
 * A search schedule is a full backfill: every tick walks the whole result set,
 * stopping only at the last page hh.ru reports.
 */
export const DEFAULT_SEARCH_CRAWL_PAGES = MAX_CRAWL_PAGES

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

const searchResult = (
  result: CrawlRunnerResult,
  chained: Record<string, unknown>
): ScheduleDispatchResult => ({
  ok: result.error === null,
  error: result.error,
  detail: {
    ...chained,
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
      const evaluation = yield* EvaluationRunner
      const fit = yield* FitJudgeRunner

      /**
       * Decides the vacancies a crawl or hydration pass just saved. It is a
       * best-effort second step: a failure is logged and recorded in the run
       * detail, but never fails the schedule whose real work already succeeded.
       */
      const evaluateSaved = (
        userId: string,
        vacancyIds: ReadonlyArray<string> | undefined,
        source: string
      ): Effect.Effect<Record<string, unknown>> => {
        if (vacancyIds === undefined || vacancyIds.length === 0) return Effect.succeed({})
        return evaluation
          .evaluateBatch(userId, {
            vacancyIds,
            limit: Math.min(vacancyIds.length, MAX_BATCH)
          })
          .pipe(
            Effect.tap((result) =>
              result.evaluated > 0
                ? Effect.logInfo(
                    `${source}: evaluated ${result.evaluated} (apply ${result.apply}, skip ${result.skip})`
                  )
                : Effect.void
            ),
            Effect.map((result) => ({
              evaluated: result.evaluated,
              evaluatedApply: result.apply,
              evaluatedSkip: result.skip
            })),
            Effect.catchCause((cause) => {
              const message = Cause.pretty(cause)
              return Effect.logWarning(`${source}: evaluation failed`, cause).pipe(
                Effect.as({ evaluationError: message.split("\n")[0] ?? "evaluation failed" })
              )
            })
          )
      }

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
                maxPages: intOption(
                  options,
                  "maxPages",
                  DEFAULT_SEARCH_CRAWL_PAGES,
                  1,
                  MAX_CRAWL_PAGES
                ),
                delayMs: intOption(options, "delayMs", 750, 0, 60_000),
                // Full crawl by default; `stopWhenNoNew: true` is an explicit opt-out.
                stopWhenNoNew: options.stopWhenNoNew === true
              })
              const chained = yield* evaluateSaved(
                schedule.userId,
                result.vacancyIds,
                `schedule ${schedule.id}`
              )
              return searchResult(result, chained)
            }

            case "vacancy_hydration": {
              const result = yield* hydration.run(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                delayMs: intOption(options, "delayMs", 1000, 0, 60_000)
              })
              const error =
                result.errors.length === 0 ? null : result.errors.join("; ")
              const chained = yield* evaluateSaved(
                schedule.userId,
                result.vacancyIds,
                `schedule ${schedule.id}`
              )
              return {
                ok: error === null,
                error,
                detail: {
                  processed: result.processed,
                  hydrated: result.hydrated,
                  failed: result.failed,
                  inserted: result.inserted,
                  updated: result.updated,
                  skipped: result.skipped,
                  ...chained
                }
              }
            }

            case "evaluate": {
              // Sweep: whatever chaining missed (a crash, a policy bump, edits
              // made outside a crawl). The target is an hh account id, or
              // `default`/`global` for the user's default account.
              const target = schedule.targetId.trim()
              const named = target !== "" && target !== "default" && target !== "global"
              const result = yield* evaluation.evaluateBatch(schedule.userId, {
                limit: intOption(options, "limit", DEFAULT_BATCH, 1, MAX_BATCH),
                force: options.force === true,
                ...(named ? { hhAccountId: target } : {})
              })
              return {
                ok: true,
                error: null,
                detail: {
                  evaluated: result.evaluated,
                  apply: result.apply,
                  draft: result.draft,
                  skip: result.skip,
                  remaining: result.remaining,
                  byReason: result.byReason
                }
              }
            }

            case "fit": {
              // Enqueues inference for the best decisions without a current
              // judgement. The answers land through the harness completion
              // path, so this tick only fills the queue. The target is the
              // resume id, or `default`/`global` for the active resume.
              const target = schedule.targetId.trim()
              const named = target !== "" && target !== "default" && target !== "global"
              const result = yield* fit.enqueue(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                onlyApply: options.onlyApply !== false,
                force: options.force === true,
                ...(named ? { resumeId: target as ResumeId } : {}),
                ...(typeof options.presetId === "string" ? { presetId: options.presetId as PresetId } : {}),
                ...(typeof options.model === "string" ? { model: options.model } : {})
              })
              return {
                ok: true,
                error: null,
                detail: { enqueued: result.enqueued, remaining: result.remaining }
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
