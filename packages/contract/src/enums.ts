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

export const KeywordMatchLocation = Schema.Literals([
  "any",
  "title",
  "body",
  "skills",
  "text_or_skills"
])

export type KeywordMatchLocation = typeof KeywordMatchLocation.Type

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

/** Who made the application: otbor, or the operator by hand on hh.ru (read back by the sync). */
export const ApplicationOrigin = Schema.Literals(["otbor", "imported"])

export type ApplicationOrigin = typeof ApplicationOrigin.Type

/**
 * Language of a writing prompt. `auto` detects it from the vacancy text for
 * application-based calls and from the input text for a resume rewrite.
 */
export const WritingLanguage = Schema.Literals(["ru", "en", "auto"])

export type WritingLanguage = typeof WritingLanguage.Type

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

export const JobStage = Schema.Literals([
  "prepare",
  "submit",
  "reconcile",
  "session",
  "inference",
  "negotiations_sync",
  "resume_sync",
  "form_read",
  "letter_attach"
])

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
  "blocked_blacklist",
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
  "reconciled",
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
  "ambiguous",
  "vacancy_archived",
  "relocation_warning"
])

export type HarnessExitTag = typeof HarnessExitTag.Type

/** How hh requests choose between configured proxy and going direct. */
export const ProxyMode = Schema.Literals(["auto", "direct", "proxy"])
export type ProxyMode = typeof ProxyMode.Type
export const ProxySource = Schema.Literals(["endpoint", "subscription"])
export type ProxySource = typeof ProxySource.Type
export const ProxyRotate = Schema.Literals(["off", "captcha"])
export type ProxyRotate = typeof ProxyRotate.Type
export const ProxyConfigOrigin = Schema.Literals(["env", "file"])
export type ProxyConfigOrigin = typeof ProxyConfigOrigin.Type

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

/**
 * What a schedule points at. `search` crawls an hh search URL; the source
 * kinds run one bounded sync of their own: hydration passes, a mail or
 * Telegram account, or an hh chat (which needs the browser harness).
 */
export const ScheduleKind = Schema.Literals([
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
  "analysis"
])

export type ScheduleKind = typeof ScheduleKind.Type

/** A schedule that syncs a source rather than crawling a saved search. */
export const SourceSyncKind = Schema.Literals([
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
  "analysis"
])

export type SourceSyncKind = typeof SourceSyncKind.Type

/** What a contact is: a way to reach a person, not the person themselves. */
export const ContactKind = Schema.Literals(["email", "telegram", "phone", "hh_chat", "other"])

export type ContactKind = typeof ContactKind.Type

/** Where the contact was found. `manual` is the only hand-entered source. */
export const ContactSource = Schema.Literals([
  "hh_vacancy",
  "mail",
  "telegram",
  "hh_chat",
  "manual"
])

export type ContactSource = typeof ContactSource.Type

/** A channel a conversation happens in. */
export const ConversationChannel = Schema.Literals(["mail", "telegram", "hh_chat"])

export type ConversationChannel = typeof ConversationChannel.Type

export const MessageDirection = Schema.Literals(["in", "out"])

export type MessageDirection = typeof MessageDirection.Type

export const MessageKind = Schema.Literals(["text", "media", "service"])

export type MessageKind = typeof MessageKind.Type

/**
 * A blacklist layer. Layers stack as labels: `app` applies to every hh account,
 * `hh_account` only to one, `hh_native` mirrors the account's own hidden list.
 * None of them deletes or permanently forbids a corpus row.
 */
export const BlacklistScope = Schema.Literals(["app", "hh_account", "hh_native"])

export type BlacklistScope = typeof BlacklistScope.Type

/**
 * Companies page view of the blacklist: `hide` drops blocked employers, `all`
 * keeps them, `only` shows blocked ones, `app` only app-level blocks and
 * `account` only blocks made for one hh account (`blockedByAccountId`).
 */
export const EmployerBlacklistView = Schema.Literals(["hide", "all", "only", "app", "account"])

export type EmployerBlacklistView = typeof EmployerBlacklistView.Type

export const BlacklistTarget = Schema.Literals(["vacancy", "employer"])

export type BlacklistTarget = typeof BlacklistTarget.Type

export const BlacklistSource = Schema.Literals(["user", "hh_hidden"])

export type BlacklistSource = typeof BlacklistSource.Type
