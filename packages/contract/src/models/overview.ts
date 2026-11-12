import { Schema } from "effect"
import { AutoMode, BlockedReason, JobStage } from "../enums.ts"
import { ApplicationId, HhAccountId, ResumeId, VacancyId } from "../ids.ts"
import { HhSessionState } from "./accounts.ts"

/** Состояния заявки, по которым overview считает «сейчас» (все время, без окна). */
export const OverviewByState = Schema.Struct({
  /** Черновик: ждёт решения оператора. */
  draft: Schema.Int,
  /** Автоотклик ждёт форму, письмо, слот или повтор. */
  preparing: Schema.Int,
  /** Слот занят, отправка стоит в очереди. */
  queued: Schema.Int,
  /** Харнесс сейчас отправляет. */
  submitting: Schema.Int,
  /** Отправлено (в том числе импортированные с hh). */
  submitted: Schema.Int,
  /** Пропущено оператором или правилами. */
  skipped: Schema.Int,
  /** Остановилось и ждёт человека. */
  needs_human: Schema.Int,
  /** Закончилось ошибкой. */
  failed: Schema.Int
})

export type OverviewByState = typeof OverviewByState.Type

/** Группа заявок, застрявших в `needs_human` или `failed`, по причине. */
export const OverviewAttention = Schema.Struct({
  /** Состояние группы. */
  state: Schema.Literals(["needs_human", "failed"]),
  /** Код причины остановки; null, если причина не записана. */
  reason: Schema.NullOr(BlockedReason),
  /** Сколько заявок в группе. */
  count: Schema.Int,
  /** Когда самая старая из них в последний раз менялась (ISO); так видно, сколько человек её не трогает. */
  oldestAt: Schema.NullOr(Schema.String)
})

export type OverviewAttention = typeof OverviewAttention.Type

/** Автоотклики в `preparing`, сгруппированные по причине ожидания. */
export const OverviewWaiting = Schema.Struct({
  /** Код причины (`daily_cap`, `form_read_failed`, `captcha`...); null - причина не записана (ждёт форму или письмо). */
  reason: Schema.NullOr(BlockedReason),
  /** Сколько заявок ждут по этой причине. */
  count: Schema.Int,
  /** Ближайший `retry_at` в группе (ISO): когда раннер попробует снова; null, если не назначен. */
  nextRetryAt: Schema.NullOr(Schema.String)
})

export type OverviewWaiting = typeof OverviewWaiting.Type

/** Отклики: что с ними сейчас и сколько отправлено. */
export const OverviewApplications = Schema.Struct({
  /** Все заявки пользователя по текущему состоянию (все origin, все время). */
  byState: OverviewByState,
  /** `needs_human` и `failed` по причинам: то, что требует человека. */
  needsAttention: Schema.Array(OverviewAttention),
  /** Черновики otbor (`state = draft`, `origin = otbor`), которые оператор ещё не отправил и не пропустил. */
  draftsToReview: Schema.Int,
  /** Автоотклики в `preparing`, сгруппированные по причине ожидания. */
  waiting: Schema.Array(OverviewWaiting),
  /**
   * Откликов за скользящие 24 часа по правилу дневного лимита hh
   * (`recentSubmits`): otbor-заявки queued/submitting/submitted по
   * `coalesce(intent_at, submitted_at)` и импортированные submitted по
   * `coalesce(hh_responded_at, submitted_at)`, по всем аккаунтам.
   */
  sentToday: Schema.Int,
  /** Отправлено (state `submitted`) за окно из `days` суток. */
  sentInWindow: Schema.Int,
  /** Отправлено за такое же по длине окно перед текущим: для стрелки тренда. */
  sentPrevWindow: Schema.Int
})

export type OverviewApplications = typeof OverviewApplications.Type

/** Воронка за окно `days`: от найденной вакансии до ответа работодателя. */
export const OverviewFunnel = Schema.Struct({
  /** Новых вакансий в общем корпусе (`vacancy.first_seen_at` в окне); корпус общий для всех пользователей. */
  vacanciesFound: Schema.Int,
  /** Решения с вердиктом apply или draft: вакансия годится к отклику. Только самое свежее решение по паре вакансия + аккаунт + резюме, созданное в окне. */
  decisionsApply: Schema.Int,
  /** Решения с вердиктом skip (то же правило «самое свежее»). */
  decisionsSkip: Schema.Int,
  /** Заявки otbor (`origin = otbor`), созданные в окне. */
  applicationsCreated: Schema.Int,
  /** Отправлено в окне (state `submitted`; otbor и импортированные). */
  sent: Schema.Int,
  /** Из отправленных в окне: работодатель открыл или ответил (hh VIEWED, INTERVIEW, OFFER, DISCARD, DISCARD_AFTER_INTERVIEW). Включает invited и rejected. */
  viewed: Schema.Int,
  /** Из отправленных в окне: приглашение или оффер (hh INTERVIEW, OFFER). */
  invited: Schema.Int,
  /** Из отправленных в окне: отказ (hh DISCARD, DISCARD_AFTER_INTERVIEW). */
  rejected: Schema.Int
})

export type OverviewFunnel = typeof OverviewFunnel.Type

/** Частая причина пропуска вакансии. */
export const OverviewSkipReason = Schema.Struct({
  /** Код первой причины решения skip (`blocked_filter`, `blocked_applied`...). */
  code: Schema.String,
  /** Сколько решений skip в окне начинаются с этой причины. */
  count: Schema.Int
})

export type OverviewSkipReason = typeof OverviewSkipReason.Type

/** Одни сутки (UTC) окна. */
export const OverviewDay = Schema.Struct({
  /** Дата YYYY-MM-DD по UTC; присутствуют все дни окна, нули тоже. */
  day: Schema.String,
  /** Новых вакансий в корпусе за сутки. */
  found: Schema.Int,
  /** Отправлено за сутки. */
  sent: Schema.Int,
  /** Приглашений и офферов за сутки (по `hh_responded_at` заявок со статусом INTERVIEW/OFFER). */
  invited: Schema.Int
})

export type OverviewDay = typeof OverviewDay.Type

/** Режим автоотклика одной строки apply filter. */
export const OverviewAutoMode = Schema.Struct({
  /** Резюме строки; null - строка действует на весь аккаунт. */
  resumeId: Schema.NullOr(ResumeId),
  /** Название резюме; null у строки аккаунта. */
  resumeTitle: Schema.NullOr(Schema.String),
  /** off - ничего, drafts - раннер готовит черновики, auto - раннер ещё и отправляет. */
  autoMode: AutoMode
})

export type OverviewAutoMode = typeof OverviewAutoMode.Type

/** Дневной расход одного аккаунта hh. */
export const OverviewUsage = Schema.Struct({
  /** Откликов за скользящие 24 часа по правилу дневного лимита. */
  used: Schema.Int,
  /** Действующий лимит: `daily_limit` строки аккаунта apply filter, иначе `OTBOR_DAILY_APPLY_LIMIT` (по умолчанию 200). */
  limit: Schema.Int,
  /** `max(0, limit - used)`. */
  remaining: Schema.Int
})

export type OverviewUsage = typeof OverviewUsage.Type

/** Один аккаунт hh одним взглядом. */
export const OverviewAccount = Schema.Struct({
  /** Идентификатор аккаунта. */
  id: HhAccountId,
  /** Что показывать: имя и фамилия, иначе метка, иначе id. */
  name: Schema.String,
  /** Цвет аккаунта в интерфейсе (null - не задан). */
  color: Schema.NullOr(Schema.String),
  /** Аккаунт по умолчанию. */
  isDefault: Schema.Boolean,
  /** Состояние входа в hh.ru; null - сессия ещё не создавалась. */
  session: Schema.NullOr(HhSessionState),
  /** Последняя ошибка сессии (если была). */
  sessionError: Schema.NullOr(Schema.String),
  /** Режимы автоотклика по строкам apply filter; пусто - автоотклик выключен. */
  autoModes: Schema.Array(OverviewAutoMode),
  /** Расход дневного лимита. */
  usage: OverviewUsage,
  /** Когда отправки аккаунта поставлены на паузу (капча); null - не на паузе. */
  submitBlockedAt: Schema.NullOr(Schema.String),
  /** Причина паузы отправок (`captcha`, `repeated_failure`). */
  submitBlockReason: Schema.NullOr(Schema.String),
  /** Исходный текст последнего отказа при `repeated_failure`. */
  submitBlockDetail: Schema.optional(Schema.NullOr(Schema.String)),
  /** Когда пауза снимется сама (ISO). */
  submitRetryAt: Schema.NullOr(Schema.String),
  /** Эпизодов капчи за 24 часа. */
  captchas24h: Schema.Int,
  /** Время последнего отправленного отклика (по правилу sent, см. `sentToday`); null - не было. */
  lastSentAt: Schema.NullOr(Schema.String),
  /** Заявок аккаунта в работе: preparing, queued, submitting. */
  active: Schema.Int,
  /** Заявок аккаунта, ждущих человека: needs_human и failed. */
  needsAttention: Schema.Int
})

export type OverviewAccount = typeof OverviewAccount.Type

/** Застрявшие задачи очереди одной стадии и статуса. */
export const OverviewStuckJobs = Schema.Struct({
  /** needs_human и needs_reconcile считаются без ограничения по времени; dead и failed только за 24 часа. */
  status: Schema.Literals(["needs_human", "needs_reconcile", "dead", "failed"]),
  /** Стадия задачи. */
  stage: JobStage,
  /** Сколько таких задач. */
  count: Schema.Int,
  /** Самое раннее `updated_at` в группе (ISO). */
  oldestAt: Schema.NullOr(Schema.String)
})

export type OverviewStuckJobs = typeof OverviewStuckJobs.Type

/** Число задач одной стадии. */
export const OverviewStageCount = Schema.Struct({
  /** Стадия задачи. */
  stage: JobStage,
  /** Сколько задач. */
  count: Schema.Int
})

export type OverviewStageCount = typeof OverviewStageCount.Type

/** Очередь харнессов: что застряло, что идёт, что ждёт. */
export const OverviewJobs = Schema.Struct({
  /** Задачи, которым нужен человек или разбор. */
  stuck: Schema.Array(OverviewStuckJobs),
  /** Выданные харнессу и идущие сейчас (leased, running) по стадиям. */
  running: Schema.Array(OverviewStageCount),
  /** Готовые к выдаче (pending, `run_at` уже наступил) по стадиям. */
  pending: Schema.Array(OverviewStageCount),
  /** Сколько секунд самая старая готовая к выдаче задача ждёт; null, если очередь пуста. */
  oldestPendingAgeSeconds: Schema.NullOr(Schema.Int)
})

export type OverviewJobs = typeof OverviewJobs.Type

/** Входящие: чаты и письма. */
export const OverviewInbox = Schema.Struct({
  /** Неархивных диалогов с `unread_count > 0` (все каналы: hh, почта, Telegram). */
  unreadConversations: Schema.Int,
  /** Время последнего входящего сообщения любого диалога (ISO); null - нет. */
  lastInboundAt: Schema.NullOr(Schema.String)
})

export type OverviewInbox = typeof OverviewInbox.Type

export const OverviewEventKind = Schema.Literals([
  "sent",
  "invited",
  "rejected",
  "viewed",
  "needs_human",
  "failed",
  "crawl_done",
  "crawl_error",
  "schedule_error",
  "captcha"
])

export type OverviewEventKind = typeof OverviewEventKind.Type

/** Событие ленты. */
export const OverviewEvent = Schema.Struct({
  /** Когда произошло (ISO). */
  at: Schema.String,
  /**
   * Что произошло. sent - отправлен отклик otbor (`submitted_at`); invited,
   * rejected, viewed - hh сменил статус отклика (время `hh_responded_at`, то
   * есть последнее изменение переговоров на hh); needs_human, failed - заявка
   * остановилась (`updated_at`); crawl_done, crawl_error - закончился поиск или
   * источник по расписанию; schedule_error - упал другой запуск расписания;
   * captcha - hh показал капчу аккаунту.
   */
  kind: OverviewEventKind,
  /** Название вакансии, цель расписания или имя аккаунта (для captcha). */
  title: Schema.String,
  /** Работодатель, текст ошибки или счётчики вроде «+12 новых»; null - нечего добавить. */
  subtitle: Schema.NullOr(Schema.String),
  /** Вакансия события, если есть. */
  vacancyId: Schema.NullOr(VacancyId),
  /** Заявка события, если есть. */
  applicationId: Schema.NullOr(ApplicationId),
  /** Аккаунт hh события, если есть. */
  hhAccountId: Schema.NullOr(HhAccountId)
})

export type OverviewEvent = typeof OverviewEvent.Type

/** Снимок «что сейчас делает вся система» для главной страницы. */
export const Overview = Schema.Struct({
  /** Когда собран снимок (ISO). */
  generatedAt: Schema.String,
  /** Длина окна в сутках после ограничения диапазоном 1..60. Окно: последние `days` суток UTC, считая сегодняшние. */
  days: Schema.Int,
  /** Отклики. */
  applications: OverviewApplications,
  /** Воронка за окно. */
  funnel: OverviewFunnel,
  /** До 6 самых частых первых причин решений skip в окне. */
  skipReasons: Schema.Array(OverviewSkipReason),
  /** По одной записи на каждые сутки окна, от старых к новым. */
  timeline: Schema.Array(OverviewDay),
  /** Аккаунты hh: сначала по умолчанию. */
  accounts: Schema.Array(OverviewAccount),
  /** Очередь задач. */
  jobs: OverviewJobs,
  /** Входящие. */
  inbox: OverviewInbox,
  /** Около 30 последних событий, свежие первыми. */
  events: Schema.Array(OverviewEvent)
})

export type Overview = typeof Overview.Type
