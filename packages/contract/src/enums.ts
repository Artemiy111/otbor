import { Schema } from "effect"

/** What the employer is looking for. A role is a policy decision, not a tag. */
export const RoleFamily = Schema.Literals([
  "devops",
  "sre",
  "platform",
  "backend",
  "frontend",
  "mobile",
  "qa",
  "analyst",
  "manager",
  "other"
])

export type RoleFamily = typeof RoleFamily.Type

export const Seniority = Schema.Literals(["junior", "middle", "senior", "lead", "unknown"])

export type Seniority = typeof Seniority.Type

/**
 * `match` is the only verdict that may be auto-applied.
 * `unknown` is a quiet "maybe" list: it never spams and never gets retried.
 * `reject` means a hard negative matched the title.
 */
export const GateVerdict = Schema.Literals(["match", "unknown", "reject"])

export type GateVerdict = typeof GateVerdict.Type

export const DecisionVerdict = Schema.Literals(["apply", "draft", "skip"])

export type DecisionVerdict = typeof DecisionVerdict.Type

export const WorkFormat = Schema.Literals(["remote", "hybrid", "office", "unknown"])

export type WorkFormat = typeof WorkFormat.Type

export const ApplicationState = Schema.Literals([
  "draft",
  "queued",
  "submitting",
  "submitted",
  "skipped",
  "needs_human",
  "failed"
])

export type ApplicationState = typeof ApplicationState.Type

export const JobStatus = Schema.Literals([
  "pending",
  "leased",
  "running",
  "done",
  "failed",
  "dead",
  "needs_human",
  "needs_reconcile",
  "cancelled"
])

export type JobStatus = typeof JobStatus.Type

export const JobStage = Schema.Literals(["prepare", "submit", "reconcile", "session", "inference"])

export type JobStage = typeof JobStage.Type

export const JobKind = Schema.Literals(["browser", "inference"])

export type JobKind = typeof JobKind.Type

export const AttemptStage = Schema.Literals(["prepare", "submit", "reconcile"])

export type AttemptStage = typeof AttemptStage.Type

export const PresetKind = Schema.Literals(["explore", "apply"])

export type PresetKind = typeof PresetKind.Type

export const LetterPolicy = Schema.Literals(["required", "optional", "never"])

export type LetterPolicy = typeof LetterPolicy.Type

export const TestsPolicy = Schema.Literals(["human", "skip", "allow"])

export type TestsPolicy = typeof TestsPolicy.Type

export const StreamMode = Schema.Literals(["drafts", "auto"])

export type StreamMode = typeof StreamMode.Type

/**
 * Closed union of decision reasons. A reason is stored, not recomputed, so
 * "why did we skip this" is a query rather than log archaeology.
 */
export const DecisionReasonCode = Schema.Literals([
  "skill_match",
  "salary",
  "remote",
  "seniority",
  "fit",
  "freshness",
  "role_match",
  "role_unknown",
  "role_rejected",
  "blocked_hidden",
  "blocked_applied",
  "blocked_archived",
  "blocked_employer_cooldown",
  "blocked_test",
  "blocked_salary",
  "blocked_work_format",
  "blocked_low_fit",
  "blocked_keywords",
  "blocked_seniority",
  "manual"
])

export type DecisionReasonCode = typeof DecisionReasonCode.Type

/** The only manual label in the product: "this is garbage". */
export const TitleVerdictSource = Schema.Literals(["rules", "llm", "user"])

export type TitleVerdictSource = typeof TitleVerdictSource.Type

/**
 * What the harness reports after an attempt. The cloud does not trust it for
 * "submitted": only reconcile against the site can set that.
 */
export const HarnessExitTag = Schema.Literals([
  "prepared",
  "clicked",
  "submitted",
  "not_submitted",
  "already_responded",
  "blocked",
  "form_changed",
  "session_expired",
  "captcha",
  "rate_limited",
  "transport",
  "resume_mismatch",
  "answer_rejected",
  "site_rejected",
  "inference_failed",
  "permanent",
  "ambiguous"
])

export type HarnessExitTag = typeof HarnessExitTag.Type

/**
 * Lifecycle of one persisted search run. `running` exists only while the crawl
 * is in flight; a crash leaves it there and the next run starts fresh rather
 * than pretending the gap was crawled.
 */
export const CrawlRunStatus = Schema.Literals(["running", "done", "stopped", "error"])

export type CrawlRunStatus = typeof CrawlRunStatus.Type

/** A run can only be finished as one of these. */
export const CrawlFinishStatus = Schema.Literals(["done", "stopped", "error"])

export type CrawlFinishStatus = typeof CrawlFinishStatus.Type
