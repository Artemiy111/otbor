import { Schema } from "effect"
import { ApplicationState, BlockedReason, ApplySort, AutoMode, SortDirection } from "../enums.ts"
import { ApplicationId, DecisionId, ResumeId, VacancyId } from "../ids.ts"

/** One vacancy the auto-apply runner would take (or take later). */
export const AutoApplyCandidate = Schema.Struct({
  decisionId: DecisionId,
  vacancyId: VacancyId,
  title: Schema.String,
  employerName: Schema.NullOr(Schema.String),
  fit: Schema.Number,
  /** Live priority (fit x freshness now). */
  priority: Schema.Number,
  publishedAt: Schema.NullOr(Schema.String),
  salaryFrom: Schema.NullOr(Schema.Int),
  salaryTo: Schema.NullOr(Schema.Int),
  salaryCurrency: Schema.NullOr(Schema.String),
  /** The resume the auto-apply WILL use (the decision's, else the account fallback); null: none resolvable. */
  resumeId: Schema.NullOr(ResumeId),
  resumeTitle: Schema.NullOr(Schema.String),
  /** 1-based position in the final order (willTake first, then next). */
  rank: Schema.Int
})

export type AutoApplyCandidate = typeof AutoApplyCandidate.Type

export const AutoApplyPreviewSettings = Schema.Struct({
  autoMode: AutoMode,
  sort: ApplySort,
  sortDirection: SortDirection,
  batchSize: Schema.Int,
  minPriority: Schema.Number,
  dailyLimit: Schema.Int
})

export type AutoApplyPreviewSettings = typeof AutoApplyPreviewSettings.Type

export const AutoApplyPreviewResult = Schema.Struct({
  settings: AutoApplyPreviewSettings,
  budget: Schema.Struct({
    used: Schema.Int,
    limit: Schema.Int,
    remaining: Schema.Int,
    oldest: Schema.NullOr(Schema.String)
  }),
  /**
   * Set when the candidates use the account fallback resume (decision without a
   * resume): the chosen one and the other resumes of the account.
   */
  fallbackResume: Schema.NullOr(
    Schema.Struct({
      id: ResumeId,
      title: Schema.String,
      others: Schema.Array(Schema.String)
    })
  ),
  /** The next run's selection: min(batchSize, remaining) items in final order. */
  willTake: Schema.Array(AutoApplyCandidate),
  /** The following (up to 20) after `willTake`. */
  next: Schema.Array(AutoApplyCandidate),
  excluded: Schema.Struct({
    /** Current apply decisions that already have an application. */
    alreadyApplied: Schema.Int,
    /** Current, not yet applied apply decisions under `minPriority`. */
    belowMinPriority: Schema.Int
  }),
  /** Not yet applied, current, at or over `minPriority`: all that could ever be taken. */
  totalCandidates: Schema.Int
})

export type AutoApplyPreviewResult = typeof AutoApplyPreviewResult.Type

export const AutoApplyStage = Schema.Literals([
  "reading_form",
  "writing",
  "kit_ready",
  "submitting",
  "submitted",
  "needs_human",
  "failed",
  "waiting",
  /** Автоотклик ждёт повтора: дневной лимит или сбой, который раннер повторит сам. */
  "blocked"
])

export type AutoApplyStage = typeof AutoApplyStage.Type

export const AutoApplyWritingJob = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  attempts: Schema.Int,
  maxAttempts: Schema.Int,
  /** When the job was queued (the queue keeps no separate start time). */
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Last update of a job that ended (done, failed, dead, cancelled). */
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  /** Raw text the model answered with (only when the job is done), trimmed. */
  resultText: Schema.optional(Schema.NullOr(Schema.String))
})

export type AutoApplyWritingJob = typeof AutoApplyWritingJob.Type

export const AutoApplyProgressItem = Schema.Struct({
  applicationId: ApplicationId,
  vacancyId: VacancyId,
  title: Schema.String,
  employerName: Schema.NullOr(Schema.String),
  /** Title of the application's resume; null while it has none. */
  resumeTitle: Schema.NullOr(Schema.String),
  autoRun: Schema.Literals(["drafts", "auto"]),
  state: ApplicationState,
  stage: AutoApplyStage,
  /** Human readable, Russian. */
  stageDetail: Schema.String,
  writingJob: Schema.NullOr(AutoApplyWritingJob),
  /** Status of the latest form_read job of the vacancy, null when none. */
  formReadStatus: Schema.NullOr(Schema.String),
  /** The kit letter for the current form hash, full text. */
  letter: Schema.NullOr(Schema.String),
  answersCount: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
  /** Типизированная причина остановки или ожидания, null когда всё идёт. */
  blockedReason: Schema.NullOr(BlockedReason),
  /** Когда раннер возобновит ждущую заявку; null без ожидания. */
  retryAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  /** The cover letter can be retried now (AutoApplyRetry would take it). */
  retryable: Schema.Boolean
})

export type AutoApplyProgressItem = typeof AutoApplyProgressItem.Type

export const AutoApplyProgressSummary = Schema.Struct({
  reading_form: Schema.Int,
  writing: Schema.Int,
  kit_ready: Schema.Int,
  submitting: Schema.Int,
  submitted: Schema.Int,
  needs_human: Schema.Int,
  failed: Schema.Int,
  waiting: Schema.Int,
  blocked: Schema.Int
})

export type AutoApplyProgressSummary = typeof AutoApplyProgressSummary.Type

export const AutoApplyProgressResult = Schema.Struct({
  items: Schema.Array(AutoApplyProgressItem),
  /** Over all auto applications of the last 3 days (account filter applies). */
  summary: AutoApplyProgressSummary
})

export type AutoApplyProgressResult = typeof AutoApplyProgressResult.Type

export const AutoApplyRetryResult = Schema.Struct({
  retried: Schema.Int,
  skipped: Schema.Array(Schema.Struct({ applicationId: ApplicationId, reason: Schema.String }))
})

export type AutoApplyRetryResult = typeof AutoApplyRetryResult.Type
