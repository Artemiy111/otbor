import type {
  ApiError,
  ApplicationState,
  AutoApplyCandidate,
  AutoApplyPreviewResult,
  AutoApplyProgressItem,
  AutoApplyProgressResult,
  AutoApplyProgressSummary,
  AutoApplyRetryResult,
  AutoApplyStage
} from "@otbor/contract"
import { ANALYSIS_PROMPT_VERSION, APPLY_POLICY_VERSION } from "@otbor/domain"
import { sql, type SQL } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import { FORM_TTL_MS } from "../repositories/VacancyFormRepository.ts"
import { ApplicationService } from "./ApplicationService.ts"
import { accountResumeTitles, type ApplyResume, resolveApplyResume } from "./applyResume.ts"
import { ApplyFilterService } from "./ApplyFilterService.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

/** Candidates shown after the ones the next run takes. */
const NEXT_LIMIT = 20
/** How far back finished auto applications are still shown and counted. */
const RECENT_DAYS = 3
const DEFAULT_PROGRESS_LIMIT = 50
const MAX_PROGRESS_LIMIT = 200

export interface AutoApplyViewServiceShape {
  readonly preview: (input: {
    readonly hhAccountId: string
    readonly resumeId?: string | undefined
  }) => Effect.Effect<AutoApplyPreviewResult, ApiError>
  readonly progress: (input: {
    readonly hhAccountId?: string | undefined
    readonly limit?: number | undefined
    readonly activeOnly?: boolean | undefined
    readonly applicationId?: string | undefined
  }) => Effect.Effect<AutoApplyProgressResult, ApiError>
  /**
   * Gives a dead cover-letter job a way out: frees its idempotency slot and
   * puts the application back where the runner picks it up. Never runs the model.
   */
  readonly retry: (input: {
    readonly applicationId?: string | undefined
    readonly hhAccountId?: string | undefined
  }) => Effect.Effect<AutoApplyRetryResult, ApiError>
}

/** A writing job is replaced at most this many times per application. */
export const MAX_WRITING_RETRIES = 5

interface ProgressRow {
  readonly id: string
  readonly vacancy_id: string
  readonly title: string | null
  readonly employer_name: string | null
  readonly resume_title: string | null
  readonly auto_run: "drafts" | "auto"
  readonly state: ApplicationState
  readonly last_error: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
  readonly submitted_at: Date | string | null
  readonly form_status: string | null
  readonly form_checked_at: Date | string | null
  readonly form_hash: string | null
  readonly kit_letter: string | null
  readonly kit_answers: number | null
  readonly kit_exists: boolean
  readonly write_id: string | null
  readonly write_status: string | null
  readonly write_attempts: number | null
  readonly write_max: number | null
  readonly write_created: Date | string | null
  readonly write_updated: Date | string | null
  readonly write_error: string | null
  readonly write_text: string | null
  readonly submit_status: string | null
  readonly intent_at: Date | string | null
  readonly write_retries: number | null
  readonly read_status: string | null
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString()

const ACTIVE_JOB = new Set(["pending", "leased", "running"])

const reason = (text: string | null): string => (text === null || text === "" ? "причина не указана" : text)

/** Stage and Russian detail of one auto application. Pure: everything it needs is in the row. */
export const deriveStage = (
  row: ProgressRow,
  now: number = Date.now()
): { readonly stage: AutoApplyStage; readonly detail: string } => {
  switch (row.state) {
    case "submitted":
      return { stage: "submitted", detail: "Отправлено" }
    case "failed":
      return { stage: "failed", detail: `Ошибка отправки: ${reason(row.last_error)}` }
    case "needs_human":
      return { stage: "needs_human", detail: `Нужен человек: ${reason(row.last_error)}` }
    case "submitting":
      return { stage: "submitting", detail: "Отправляется" }
    default:
      break
  }

  if (row.submit_status !== null) {
    return {
      stage: "submitting",
      detail: row.submit_status === "pending" ? "Отправка в очереди" : "Отправляется"
    }
  }

  const formFresh =
    row.form_hash !== null &&
    row.form_checked_at !== null &&
    now - new Date(row.form_checked_at).getTime() <= FORM_TTL_MS
  if (row.read_status === "running" || row.read_status === "leased") {
    return { stage: "reading_form", detail: "Читается форма отклика" }
  }
  if (!formFresh) {
    return { stage: "waiting", detail: "Ждёт чтения формы" }
  }

  if (row.kit_exists) {
    return row.auto_run === "auto"
      ? { stage: "kit_ready", detail: "Кит готов, отправка в очереди" }
      : { stage: "kit_ready", detail: "Кит готов, ждёт вашей отправки" }
  }

  if (row.write_status === null) {
    return { stage: "waiting", detail: "Ждёт постановки письма" }
  }
  if (ACTIVE_JOB.has(row.write_status)) {
    const attempt = Math.max(1, row.write_attempts ?? 0)
    return {
      stage: "writing",
      detail: `Пишется письмо (попытка ${attempt} из ${row.write_max ?? 3})`
    }
  }
  if (row.write_status === "done") {
    return { stage: "writing", detail: "Письмо написано, сохраняется кит" }
  }
  return {
    stage: "failed",
    detail: `Письмо не написано: ${reason(row.write_error)}`
  }
}

const FAILED_JOB = new Set(["failed", "dead", "cancelled"])
const RETRY_STATES = new Set<ApplicationState>(["needs_human", "draft", "queued"])

/**
 * Why the cover letter of this auto application cannot be retried, or null when
 * it can. The one predicate behind `AutoApplyProgressItem.retryable` and
 * `AutoApplyRetry`. It never allows anything that may have been sent: a submit
 * job or an intent row closes the door, whatever the writing job did.
 */
export const retryBlock = (row: ProgressRow): string | null => {
  if (row.auto_run === null) return "это не автоотклик"
  if (!RETRY_STATES.has(row.state)) return "отклик уже не ждёт письма"
  if (row.intent_at !== null || row.submit_status !== null) return "отправка уже начиналась"
  if (row.kit_exists) return "кит для текущей формы уже есть"
  if (row.write_status === null) return "задачи письма нет, бегунок поставит её сам"
  if (!FAILED_JOB.has(row.write_status)) return "письмо ещё пишется или уже написано"
  if ((row.write_retries ?? 0) >= MAX_WRITING_RETRIES) {
    return `исчерпан лимит повторов (${MAX_WRITING_RETRIES}), причина: ${reason(row.write_error)}`
  }
  return null
}

/** The progress rows (one application, or a filtered set) with everything the stage and the retry need. */
const progressRows = (tx: Executor, userId: string, where: SQL) =>
  tx
    .execute(sql`
      select a.id, a.vacancy_id, v.title, e.name as employer_name, r.title as resume_title, a.auto_run, a.state,
        a.last_error, a.created_at, a.updated_at, a.submitted_at, a.intent_at,
        fs.status as form_status, fs.checked_at as form_checked_at, ver.form_hash,
        kit.letter as kit_letter,
        case when kit.id is null then null else jsonb_array_length(kit.answers) end as kit_answers,
        (kit.id is not null) as kit_exists,
        wj.id as write_id, wj.status as write_status, wj.attempts as write_attempts,
        wj.max_attempts as write_max, wj.created_at as write_created,
        wj.updated_at as write_updated, wj.last_error as write_error,
        left(wj.result->>'text', 20000) as write_text,
        (select count(*)::int from harness_jobs rj2
          where rj2.idempotency_key like 'autoapply:writing:' || a.id::text || ':%:retried:%') as write_retries,
        sj.status as submit_status,
        rj.status as read_status
      from application a
      join vacancy v on v.id = a.vacancy_id
      left join employer e on e.id = v.employer_id
      left join resume r on r.id = a.resume_id
      left join vacancy_form_state fs on fs.vacancy_id = a.vacancy_id
      left join vacancy_form_version ver on ver.id = fs.current_version_id
      left join lateral (
        select k.id, k.letter, k.answers from application_kit k
        where k.application_id = a.id and k.form_hash = ver.form_hash
        order by k.created_at desc limit 1
      ) kit on true
      -- the key is writingKey(application, formHash) of AutoApplyRunner; a replaced
      -- (retried) job keeps its history under '<key>:retried:<n>'
      left join lateral (
        select j.id, j.status, j.attempts, j.max_attempts, j.created_at, j.updated_at, j.last_error, j.result
        from harness_jobs j
        where j.idempotency_key = 'autoapply:writing:' || a.id::text || ':' || ver.form_hash
      ) wj on true
      left join lateral (
        select j.status from harness_jobs j
        where j.application_id = a.id and j.stage = 'submit' and j.status <> 'cancelled'
        order by j.created_at desc limit 1
      ) sj on true
      left join lateral (
        select j.status from harness_jobs j
        where j.stage = 'form_read' and j.status <> 'cancelled'
          and j.payload->>'vacancyId' = a.vacancy_id::text
        order by j.created_at desc limit 1
      ) rj on true
      where a.user_id = ${userId}
        and a.auto_run is not null
        and a.state <> 'skipped'
        and ${where}
      order by a.created_at desc, a.id desc
    `)
    .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<ProgressRow>))

export class AutoApplyViewService extends Context.Service<AutoApplyViewService, AutoApplyViewServiceShape>()(
  "otbor/cloud/AutoApplyViewService"
) {
  static readonly layer = Layer.effect(
    AutoApplyViewService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const applications = yield* ApplicationService
      const applyFilters = yield* ApplyFilterService
      const userId = currentUser.userId

      const preview: AutoApplyViewServiceShape["preview"] = Effect.fn("AutoApplyViewService.preview")(
        function*(input) {
          const resumeId = input.resumeId ?? null
          // Validates the pair (NotFound) and resolves exact -> account -> default.
          const settings = yield* applyFilters.get({ hhAccountId: input.hhAccountId, resumeId })
          const usage = yield* applications.dailyUsage(input.hhAccountId)

          const view = yield* database
            .asUser(userId, (tx) =>
              Effect.gen(function*() {
                const pending = yield* ApplicationRepository.pendingAutoSlots(tx, userId, input.hhAccountId)
                const rows = yield* ApplyFilterRepository.listForUser(tx, userId, input.hhAccountId)
                const pairResumeIds = rows.flatMap((row) => (row.resumeId === null ? [] : [row.resumeId]))
                const remaining = Math.max(
                  0,
                  usage.remaining - (settings.autoMode === "auto" ? pending : 0)
                )
                const takeCount = Math.min(settings.batchSize, remaining)
                // The very selection the runner makes, with room for what comes after it.
                const options = {
                  hhAccountId: input.hhAccountId,
                  resumeId,
                  excludeResumeIds: resumeId === null ? pairResumeIds : [],
                  minPriority: settings.minPriority,
                  sort: settings.sort,
                  sortDirection: settings.sortDirection,
                  limit: takeCount + NEXT_LIMIT,
                  policyVersion: APPLY_POLICY_VERSION,
                  analysisPromptVersion: ANALYSIS_PROMPT_VERSION
                } satisfies DecisionRepository.AutoApplyCandidateOptions
                const candidates = yield* DecisionRepository.autoApplyCandidateRows(tx, userId, options)
                const counts = yield* DecisionRepository.autoApplyCounts(tx, userId, options)
                // The resume each candidate WILL use: the very function the runner calls.
                const resolved = new Map<string, ApplyResume | null>()
                for (const row of candidates) {
                  const key = row.resume_id ?? ""
                  if (!resolved.has(key)) {
                    resolved.set(key, yield* resolveApplyResume(tx, userId, input.hhAccountId, row.resume_id))
                  }
                }
                const allResumes = yield* accountResumeTitles(tx, userId, input.hhAccountId)
                return { takeCount, candidates, counts, resolved, allResumes }
              })
            )
            .pipe(Effect.mapError(toStorageError("autoApply.preview")))

          const items = view.candidates.map(
            (row, index): AutoApplyCandidate => ({
              decisionId: row.id as AutoApplyCandidate["decisionId"],
              vacancyId: row.vacancy_id as AutoApplyCandidate["vacancyId"],
              title: row.vacancy_title ?? "",
              employerName: row.employer_name,
              fit: row.fit,
              priority: Number(row.live_priority ?? row.priority),
              publishedAt: iso(row.published_at),
              salaryFrom: row.salary_from,
              salaryTo: row.salary_to,
              salaryCurrency: row.salary_currency,
              resumeId: (view.resolved.get(row.resume_id ?? "")?.id ?? null) as AutoApplyCandidate["resumeId"],
              resumeTitle: view.resolved.get(row.resume_id ?? "")?.title ?? null,
              rank: index + 1
            })
          )

          const fallback = [...view.resolved.values()].find((value) => value !== null && value.fallback)
          const fallbackResume =
            fallback === undefined || fallback === null || view.allResumes.length < 2
              ? null
              : {
                  id: fallback.id as NonNullable<AutoApplyCandidate["resumeId"]>,
                  title: fallback.title,
                  others: view.allResumes.filter((r) => r.id !== fallback.id).map((r) => r.title)
                }

          return {
            fallbackResume,
            settings: {
              autoMode: settings.autoMode,
              sort: settings.sort,
              sortDirection: settings.sortDirection,
              batchSize: settings.batchSize,
              minPriority: settings.minPriority,
              dailyLimit: settings.dailyLimit
            },
            budget: { used: usage.used, limit: usage.limit, remaining: usage.remaining, oldest: usage.oldest },
            willTake: items.slice(0, view.takeCount),
            next: items.slice(view.takeCount, view.takeCount + NEXT_LIMIT),
            excluded: {
              alreadyApplied: view.counts.alreadyApplied,
              belowMinPriority: view.counts.belowMinPriority
            },
            totalCandidates: view.counts.total
          } satisfies AutoApplyPreviewResult
        }
      )

      const progress: AutoApplyViewServiceShape["progress"] = Effect.fn("AutoApplyViewService.progress")(
        function*(input) {
          const limit = Math.min(MAX_PROGRESS_LIMIT, Math.max(1, Math.trunc(input.limit ?? DEFAULT_PROGRESS_LIMIT)))
          const accountFilter =
            input.hhAccountId === undefined ? sql`true` : sql`a.hh_account_id = ${input.hhAccountId}`
          const rows = yield* database
            .asUser(userId, (tx) =>
              progressRows(
                tx,
                userId,
                input.applicationId === undefined
                  ? sql`${accountFilter}
                  and (a.state in ('draft', 'queued', 'submitting')
                    or a.updated_at > now() - ${`${RECENT_DAYS} days`}::interval)`
                  : sql`a.id = ${input.applicationId}`
              )
            )
            .pipe(Effect.mapError(toStorageError("autoApply.progress")))

          const summary: { -readonly [K in keyof AutoApplyProgressSummary]: number } = {
            reading_form: 0,
            writing: 0,
            kit_ready: 0,
            submitting: 0,
            submitted: 0,
            needs_human: 0,
            failed: 0,
            waiting: 0
          }
          const now = Date.now()
          const items: Array<AutoApplyProgressItem> = []
          for (const row of rows) {
            const { stage, detail } = deriveStage(row, now)
            summary[stage] += 1
            const terminal = stage === "submitted" || stage === "needs_human" || stage === "failed"
            if (input.activeOnly === true && terminal) continue
            if (items.length >= limit) continue
            const ended = row.write_status !== null && !ACTIVE_JOB.has(row.write_status)
            items.push({
              applicationId: row.id as AutoApplyProgressItem["applicationId"],
              vacancyId: row.vacancy_id as AutoApplyProgressItem["vacancyId"],
              title: row.title ?? "",
              employerName: row.employer_name,
              resumeTitle: row.resume_title,
              autoRun: row.auto_run,
              state: row.state,
              stage,
              stageDetail: detail,
              writingJob:
                row.write_id === null
                  ? null
                  : {
                      id: row.write_id,
                      status: row.write_status ?? "pending",
                      attempts: row.write_attempts ?? 0,
                      maxAttempts: row.write_max ?? 3,
                      startedAt: iso(row.write_created),
                      finishedAt: ended ? iso(row.write_updated) : null,
                      error: row.write_error,
                      resultText: row.kit_exists ? null : row.write_text
                    },
              formReadStatus: row.read_status,
              letter: row.kit_letter,
              answersCount: row.kit_answers ?? 0,
              lastError: row.last_error,
              createdAt: new Date(row.created_at).toISOString(),
              updatedAt: new Date(row.updated_at).toISOString(),
              submittedAt: iso(row.submitted_at),
              retryable: retryBlock(row) === null
            })
          }
          return { items, summary } satisfies AutoApplyProgressResult
        }
      )

      const retryOne = (applicationId: string) =>
        database
          .asUser(userId, (tx) =>
            Effect.gen(function*() {
              // Serializes two retries of the same application: the second one sees the first's result.
              const locked = yield* tx.execute(
                sql`select id from application where id = ${applicationId} and user_id = ${userId} for update`
              )
              if (locked.rows.length === 0) return "не найден"
              const [row] = yield* progressRows(tx, userId, sql`a.id = ${applicationId}`)
              if (row === undefined) return "это не автоотклик"
              const blocked = retryBlock(row)
              if (blocked !== null) return blocked
              // Free the slot, keep the dead job and its error as history.
              const freed = yield* tx.execute(sql`
                update harness_jobs
                set idempotency_key = idempotency_key || ':retried:' || ${(row.write_retries ?? 0) + 1}::text,
                    updated_at = now()
                where id = ${row.write_id} and status in ('failed', 'dead', 'cancelled')
                returning id
              `)
              if (freed.rows.length === 0) return "задача письма уже изменилась"
              // Only a state the runner owns; intent_at stays untouched and null.
              yield* tx.execute(sql`
                update application
                set state = case when state = 'needs_human'
                      then (case when auto_run = 'auto' then 'queued' else 'draft' end)
                      else state end,
                    last_error = null, updated_at = now()
                where id = ${applicationId} and user_id = ${userId} and intent_at is null
                  and auto_run is not null and state in ('needs_human', 'draft', 'queued')
              `)
              return null
            })
          )
          .pipe(Effect.mapError(toStorageError("autoApply.retry")))

      const retry: AutoApplyViewServiceShape["retry"] = Effect.fn("AutoApplyViewService.retry")(
        function*(input) {
          const skipped: Array<{ applicationId: AutoApplyRetryResult["skipped"][number]["applicationId"]; reason: string }> = []
          let retried = 0
          let ids: ReadonlyArray<string>
          if (input.applicationId !== undefined) {
            ids = [input.applicationId]
          } else {
            const accountFilter =
              input.hhAccountId === undefined ? sql`true` : sql`a.hh_account_id = ${input.hhAccountId}`
            const rows = yield* database
              .asUser(userId, (tx) =>
                progressRows(tx, userId, sql`${accountFilter} and a.state in ('needs_human', 'draft', 'queued')`)
              )
              .pipe(Effect.mapError(toStorageError("autoApply.retryScan")))
            // Only applications whose writing job died; the others are not "stopped" ones.
            ids = rows.filter((row) => row.write_status !== null && FAILED_JOB.has(row.write_status)).map((row) => row.id)
          }
          for (const id of ids) {
            const blocked = yield* retryOne(id)
            if (blocked === null) retried += 1
            else skipped.push({ applicationId: id as (typeof skipped)[number]["applicationId"], reason: blocked })
          }
          yield* Effect.logInfo(`autoapply retry: ${retried} retried, ${skipped.length} skipped`)
          return { retried, skipped } satisfies AutoApplyRetryResult
        }
      )

      return AutoApplyViewService.of({ preview, progress, retry })
    })
  )
}
