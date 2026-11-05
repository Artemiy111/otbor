import type {
  ApiError,
  ApplicationState,
  AutoApplyCandidate,
  AutoApplyPreviewResult,
  AutoApplyProgressItem,
  AutoApplyProgressResult,
  AutoApplyProgressSummary,
  AutoApplyStage
} from "@otbor/contract"
import { ANALYSIS_PROMPT_VERSION, APPLY_POLICY_VERSION } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import { FORM_TTL_MS } from "../repositories/VacancyFormRepository.ts"
import { ApplicationService } from "./ApplicationService.ts"
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
  }) => Effect.Effect<AutoApplyProgressResult, ApiError>
}

interface ProgressRow {
  readonly id: string
  readonly vacancy_id: string
  readonly title: string | null
  readonly employer_name: string | null
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
  readonly submit_status: string | null
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
                return { takeCount, candidates, counts }
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
              resumeId: row.resume_id as AutoApplyCandidate["resumeId"],
              rank: index + 1
            })
          )

          return {
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
          const rows = yield* database
            .asUser(userId, (tx) =>
              tx
                .execute(sql`
                  select a.id, a.vacancy_id, v.title, e.name as employer_name, a.auto_run, a.state,
                    a.last_error, a.created_at, a.updated_at, a.submitted_at,
                    fs.status as form_status, fs.checked_at as form_checked_at, ver.form_hash,
                    kit.letter as kit_letter,
                    case when kit.id is null then null else jsonb_array_length(kit.answers) end as kit_answers,
                    (kit.id is not null) as kit_exists,
                    wj.id as write_id, wj.status as write_status, wj.attempts as write_attempts,
                    wj.max_attempts as write_max, wj.created_at as write_created,
                    wj.updated_at as write_updated, wj.last_error as write_error,
                    sj.status as submit_status,
                    rj.status as read_status
                  from application a
                  join vacancy v on v.id = a.vacancy_id
                  left join employer e on e.id = v.employer_id
                  left join vacancy_form_state fs on fs.vacancy_id = a.vacancy_id
                  left join vacancy_form_version ver on ver.id = fs.current_version_id
                  left join lateral (
                    select k.id, k.letter, k.answers from application_kit k
                    where k.application_id = a.id and k.form_hash = ver.form_hash
                    order by k.created_at desc limit 1
                  ) kit on true
                  -- the key is writingKey(application, formHash) of AutoApplyRunner
                  left join lateral (
                    select j.id, j.status, j.attempts, j.max_attempts, j.created_at, j.updated_at, j.last_error
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
                    ${input.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${input.hhAccountId}`}
                    and (a.state in ('draft', 'queued', 'submitting')
                      or a.updated_at > now() - ${`${RECENT_DAYS} days`}::interval)
                  order by a.created_at desc, a.id desc
                `)
                .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<ProgressRow>))
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
                      error: row.write_error
                    },
              formReadStatus: row.read_status,
              letter: row.kit_letter,
              answersCount: row.kit_answers ?? 0,
              lastError: row.last_error,
              createdAt: new Date(row.created_at).toISOString(),
              updatedAt: new Date(row.updated_at).toISOString(),
              submittedAt: iso(row.submitted_at)
            })
          }
          return { items, summary } satisfies AutoApplyProgressResult
        }
      )

      return AutoApplyViewService.of({ preview, progress })
    })
  )
}
