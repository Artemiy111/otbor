import { Schema } from "effect"

export const Seniority = Schema.Literals(["junior", "middle", "senior", "lead", "unknown"])

export type Seniority = typeof Seniority.Type

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
  /** Автоотклик без слота: ждёт форму, письмо, кит или повтор. */
  "preparing",
  /** Слот занят, submit поставлен в очередь. */
  "queued",
  "submitting",
  "submitted",
  "skipped",
  "needs_human",
  "failed"
])

export type ApplicationState = typeof ApplicationState.Type

/**
 * Замкнутый набор причин, по которым заявка стоит или ждёт человека.
 * Транзиентные (`daily_cap`, `writing_failed`, `form_read_failed`) у автоотклика
 * сначала оставляют `preparing` с `retryAt`; остальные ведут в `needs_human`.
 */
export const BlockedReason = Schema.Literals([
  "no_resume",
  "form_unreadable",
  "form_gone",
  "form_read_failed",
  "form_hint_blocked",
  "kit_refused",
  "writing_failed",
  "daily_cap",
  "captcha",
  "submit_not_sent",
  "reconcile_unclear",
  "operator"
])

export type BlockedReason = typeof BlockedReason.Type

/** Смысл кода по-русски: для веба, CLI и описаний прогресса. */
export const BLOCKED_REASON_LABELS: Readonly<Record<BlockedReason, string>> = {
  no_resume: "не выбрано резюме для откликов",
  form_unreadable: "форма отклика не распознана",
  form_gone: "вакансия больше не принимает отклики",
  form_read_failed: "форму отклика не удалось прочитать",
  form_hint_blocked: "подсказка ответа заблокирована",
  kit_refused: "письмо или ответы не прошли проверку",
  writing_failed: "письмо не написано",
  daily_cap: "дневной лимит откликов",
  captcha: "hh попросил капчу, отправки аккаунта на паузе",
  submit_not_sent: "отклик не был отправлен",
  reconcile_unclear: "не удалось установить, ушёл ли отклик",
  operator: "нужно решение человека"
}

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
  "letter_attach",
  "chat_read",
  "resume_bump"
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

/** What the auto-apply runner does for a filter: nothing, prepare drafts, or send. */
export const AutoMode = Schema.Literals(["off", "drafts", "auto"])

export type AutoMode = typeof AutoMode.Type

/** In which order the runner takes decisions. */
export const ApplySort = Schema.Literals(["priority", "fit", "newest", "salary"])

export type ApplySort = typeof ApplySort.Type

/** `desc` takes the best candidates first; `asc` reverses the whole order. */
export const SortDirection = Schema.Literals(["desc", "asc"])

export type SortDirection = typeof SortDirection.Type

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
  /** Hard blocks of the apply filter; `detail` lists the failed rules. */
  "blocked_filter",
  "manual"
])

export type DecisionReasonCode = typeof DecisionReasonCode.Type

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
  "analysis",
  "apply",
  "resume_bump"
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
  "analysis",
  "apply",
  "resume_bump"
])

export type SourceSyncKind = typeof SourceSyncKind.Type

/**
 * What a contact is: a way to reach a person, not the person themselves.
 * `telegram_id` is the stable numeric Telegram user id (a username can change).
 */
export const ContactKind = Schema.Literals([
  "email",
  "telegram",
  "telegram_id",
  "phone",
  "hh_chat",
  "other"
])

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

/** How a contact was attached to a person: by a sure signal, suggested, or by the operator. */
export const PersonLink = Schema.Literals(["auto", "suggested", "manual"])

export type PersonLink = typeof PersonLink.Type
