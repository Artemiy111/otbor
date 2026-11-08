import type { ApiError, PresetId, ResumeId, ProxyMode } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ScheduleRunRepository from "../repositories/ScheduleRunRepository.ts"
import type { StoredSchedule } from "../repositories/ScheduleRepository.ts"
import { CrawlRunner, type CrawlRunnerResult } from "./CrawlRunner.ts"
import { AnalysisRunner } from "./AnalysisRunner.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import { AutoApplyRunner } from "./AutoApplyRunner.ts"
import { enqueueChatReads } from "./ChatSync.ts"
import { DEFAULT_BATCH, MAX_BATCH } from "./decisionEvaluation.ts"
import { EmployerHydrator } from "./EmployerHydrator.ts"
import { EvaluationRunner } from "./EvaluationRunner.ts"
import { FitJudgeRunner } from "./FitJudgeRunner.ts"
import { HydrationRunner } from "./HydrationRunner.ts"
import { MailSync } from "./MailSync.ts"
import { ResumeSync } from "./ResumeSync.ts"
import { toStorageError } from "./support.ts"
import { TelegramSync } from "./TelegramSync.ts"

export interface ScheduleDispatchResult {
  readonly ok: boolean
  readonly error: string | null
  readonly detail?: Record<string, unknown>
}

export interface ScheduleRunContext {
  /** `schedule_run` row to update with live progress, if available. */
  readonly runId?: string | undefined
}

export interface ScheduleDispatcherShape {
  /** Runs exactly one bounded pass for a claimed schedule row. */
  readonly run: (
    schedule: StoredSchedule,
    context?: ScheduleRunContext
  ) => Effect.Effect<ScheduleDispatchResult, ApiError>
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

const proxyModeOption = (options: Record<string, unknown>): ProxyMode | null => {
  const value = options.proxyMode
  if (value === undefined) return "auto"
  return value === "auto" || value === "direct" || value === "proxy" ? value : null
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
      const database = yield* Database
      const mail = yield* MailSync
      const telegram = yield* TelegramSync
      const evaluation = yield* EvaluationRunner
      const fit = yield* FitJudgeRunner
      const resumeSync = yield* ResumeSync
      const analysis = yield* AnalysisRunner
      const autoApply = yield* AutoApplyRunner

      /**
       * Подтягивает вакансии, на которые ссылались в Telegram, но которых нет в базе.
       * Не больше `max` за проход, в случайном порядке (недоступная вакансия не
       * должна вечно занимать очередь). Ингест перелинковывает ждавшие диалоги.
       * Сбой одной вакансии не валит расписание.
       */
      const fetchPendingVacancies = (userId: string, max: number): Effect.Effect<number> =>
        Effect.gen(function*() {
          if (max <= 0) return 0
          const refs = yield* database.asUser(userId, (tx) =>
            ConversationRepository.listVacancyRefs(tx, userId)
          )
          const ids = [...new Set(refs.filter((ref) => ref.source === "hh").map((ref) => ref.externalId))]
          for (let index = ids.length - 1; index > 0; index -= 1) {
            const other = Math.floor(Math.random() * (index + 1))
            const swap = ids[index]!
            ids[index] = ids[other]!
            ids[other] = swap
          }
          let fetched = 0
          for (const externalId of ids.slice(0, max)) {
            const ok = yield* hydration.fetchByReference(userId, externalId).pipe(
              Effect.as(true),
              Effect.catch((error) =>
                Effect.logWarning(`pending vacancy ${externalId} was not fetched: ${JSON.stringify(error)}`).pipe(
                  Effect.as(false)
                )
              )
            )
            if (ok) fetched += 1
          }
          return fetched
        }).pipe(Effect.catchCause(() => Effect.succeed(0)))

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

      const persistProgress = (runId: string | undefined, detail: Record<string, unknown>) =>
        runId === undefined
          ? Effect.void
          : database
              .asOwner((tx) => ScheduleRunRepository.updateDetail(tx, runId, detail))
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(`schedule run ${runId}: could not persist progress`, cause))
              )

      const run: ScheduleDispatcherShape["run"] = (schedule, context) =>
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
              const proxyMode = proxyModeOption(options)
              if (proxyMode === null) {
                return yield* new InvalidInput({
                  message: `schedule ${schedule.id}: proxyMode must be auto, direct or proxy`
                })
              }
              const runId = context?.runId
              const result = yield* hydration.run(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                delayMs: intOption(options, "delayMs", 1000, 0, 60_000),
                proxyMode,
                onProgress: (progress) => persistProgress(runId, { ...progress })
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
                  target: result.target, // full list size, not only completed items
                  hydrated: result.hydrated,
                  failed: result.failed,
                  inserted: result.inserted,
                  updated: result.updated,
                  skipped: result.skipped,
                  proxyMode: result.proxyMode,
                  proxy: result.proxy,
                  proxySource: result.proxySource,
                  stoppedBy: result.stoppedBy,
                  rotations: result.rotations,
                  errors: result.errors,
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
              const proxyMode = proxyModeOption(options)
              if (proxyMode === null) {
                return yield* new InvalidInput({
                  message: `schedule ${schedule.id}: proxyMode must be auto, direct or proxy`
                })
              }
              const runId = context?.runId
              const result = yield* employers.run(schedule.userId, {
                limit: intOption(options, "limit", 25, 1, 200),
                delayMs: intOption(options, "delayMs", 750, 0, 60_000),
                proxyMode,
                onProgress: (progress) => persistProgress(runId, { ...progress })
              })
              const error =
                result.errors.length === 0 ? null : result.errors.join("; ")
              return {
                ok: error === null,
                error,
                detail: {
                  processed: result.processed,
                  target: result.target,
                  updated: result.updated,
                  failed: result.failed,
                  proxyMode: result.proxyMode,
                  proxy: result.proxy,
                  proxySource: result.proxySource,
                  stoppedBy: result.stoppedBy,
                  rotations: result.rotations,
                  errors: result.errors
                }
              }
            }

            case "analysis": {
              // Local SystemOne model over fully hydrated vacancies whose
              // analysis is missing or stale. The target is not used.
              const runId = context?.runId
              const result = yield* analysis.run({
                limit: intOption(options, "limit", 50, 1, 500),
                delayMs: intOption(options, "delayMs", 0, 0, 60_000),
                onProgress: (progress) => persistProgress(runId, { ...progress })
              })
              const error = result.errors.length === 0 ? null : result.errors.join("; ")
              return {
                ok: error === null,
                error,
                detail: {
                  processed: result.processed,
                  analysed: result.analysed,
                  skipped: result.skipped,
                  failed: result.failed,
                  stoppedBy: result.stoppedBy,
                  errors: result.errors
                }
              }
            }

            case "apply": {
              // Auto-apply pass: creates applications for accounts whose apply
              // filter is not `off`, writes their letters, stores kits. The
              // target is an hh account id, or `default`/`global` for all of
              // the user's accounts.
              const target = schedule.targetId.trim()
              const named = target !== "" && target !== "default" && target !== "global"
              const result = yield* autoApply.run(schedule.userId, named ? { hhAccountId: target } : {})
              const error = result.errors.length === 0 ? null : result.errors.join("; ")
              return {
                ok: error === null,
                error,
                detail: {
                  accounts: result.accounts,
                  selected: result.selected,
                  created: result.created,
                  writingEnqueued: result.writingEnqueued,
                  kitsSet: result.kitsSet,
                  submitQueued: result.submitQueued,
                  needsHuman: result.needsHuman,
                  waiting: result.waiting,
                  errors: result.errors
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
                dialogs: intOption(options, "dialogs", 100, 1, 100),
                messages: intOption(options, "messages", 50, 1, 200)
              })
              // Ссылки на вакансии, которых ещё нет в базе: догружаем несколько
              // страниц (`vacancyFetch`, 0 — не догружать).
              const vacanciesFetched = yield* fetchPendingVacancies(
                schedule.userId,
                intOption(options, "vacancyFetch", 5, 0, 50)
              )
              const base = syncResult(result)
              return { ...base, detail: { ...base.detail, vacanciesFetched } }
            }

            case "resume_sync": {
              // Only enqueues browser jobs: the harness reads hh and the
              // completion path stores the resumes. The target is an hh account
              // id, or `global` for every account of the user.
              const result = yield* resumeSync.enqueue(schedule.userId, schedule.targetId)
              return {
                ok: true,
                error: null,
                detail: { queued: result.queued, alreadyActive: result.alreadyActive }
              }
            }

            case "hh_chat_sync": {
              // Только ставит `chat_read` для откликов без свежей копии чата: читает
              // hh браузерный harness, сохраняет `QueueService.complete`. Цель — id
              // аккаунта hh или `global`/пусто для всех аккаунтов пользователя.
              const target = schedule.targetId.trim()
              const named = target !== "" && target !== "default" && target !== "global"
              const result = yield* database
                .asUser(schedule.userId, (tx) =>
                  enqueueChatReads(tx, schedule.userId, {
                    ...(named ? { hhAccountId: target } : {}),
                    limit: intOption(options, "limit", 20, 1, 200),
                    staleHours: intOption(options, "staleHours", 24, 0, 24 * 365)
                  })
                )
                .pipe(Effect.mapError(toStorageError("schedule.hh_chat_sync")))
              return {
                ok: true,
                error: null,
                detail: { queued: result.queued, candidates: result.candidates }
              }
            }

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
