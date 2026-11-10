import { Schema } from "effect"
import { JobKind, JobStage, JobStatus } from "../enums.ts"
import { ApplicationId, HarnessId, HarnessJobId, HhAccountId, LeaseId, VacancyId } from "../ids.ts"

export const HarnessJob = Schema.Struct({
  id: HarnessJobId,
  kind: JobKind,
  stage: JobStage,
  status: JobStatus,
  priority: Schema.Int,
  payload: Schema.Unknown,
  /** Inference output, filled by the harness on completion. */
  result: Schema.optional(Schema.NullOr(Schema.Unknown)),
  attempts: Schema.Int,
  maxAttempts: Schema.Int,
  leaseId: Schema.NullOr(LeaseId),
  leaseEpoch: Schema.Int,
  leaseUntil: Schema.optional(Schema.NullOr(Schema.String)),
  runAt: Schema.String,
  createdAt: Schema.String
})

export type HarnessJob = typeof HarnessJob.Type

/**
 * Задача очереди для страницы «Очереди»: `HarnessJob` плюс то, что сервер уже
 * разрешил сам (аккаунт, вакансия, отклик, текст ошибки), чтобы страница не
 * разбирала сырой `payload`.
 */
export const QueueJob = Schema.Struct({
  ...HarnessJob.fields,
  /** `harness_jobs.hh_account_id`, а у задач без него - аккаунт отклика. */
  hhAccountId: Schema.NullOr(HhAccountId),
  /** Имя аккаунта как в списке аккаунтов: имя и фамилия, иначе метка. */
  accountName: Schema.NullOr(Schema.String),
  /** Вакансия отклика, а у задач без отклика (чтение формы) - `payload.vacancyId`. */
  vacancyId: Schema.NullOr(VacancyId),
  vacancyTitle: Schema.NullOr(Schema.String),
  applicationId: Schema.NullOr(ApplicationId),
  /** `harness_jobs.last_error`: почему задача не удалась; null, если ошибки не было. */
  lastError: Schema.NullOr(Schema.String)
})

export type QueueJob = typeof QueueJob.Type

/**
 * An ACP prompt carried inside the job envelope. The cloud never sends free
 * text to a model directly: it enqueues this payload, and an inference
 * harness runs it through `opencode acp` or another ACP agent.
 */
export const InferencePayload = Schema.Struct({
  prompt: Schema.String,
  system: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  /** Optional JSON schema the agent should satisfy with its answer. */
  jsonSchema: Schema.optional(Schema.Unknown),
  /** ACP agent id from the harness catalog (`opencode`, `claude`). Default: the harness default. */
  harness: Schema.optional(Schema.String),
  /** Reasoning effort / thinking level, one of the model's `efforts`. */
  effort: Schema.optional(Schema.String)
})

export type InferencePayload = typeof InferencePayload.Type

/**
 * What a harness can run: ACP agents (OpenCode, Claude Code ...), their models
 * and the effort levels each model accepts. Probed by the harness itself and
 * reported to the cloud; the cloud never starts an agent.
 */
export const AgentModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** Allowed effort values; empty: the model has no effort choice. */
  efforts: Schema.Array(Schema.String),
  defaultEffort: Schema.optional(Schema.NullOr(Schema.String)),
  /** Shown under the name, e.g. subscription vs API credits. */
  variant: Schema.optional(Schema.NullOr(Schema.String))
})

export type AgentModel = typeof AgentModel.Type

export const AgentHarness = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** False when the agent could not be started or is not signed in. */
  available: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  models: Schema.Array(AgentModel),
  defaultModel: Schema.NullOr(Schema.String)
})

export type AgentHarness = typeof AgentHarness.Type

export const AgentCatalog = Schema.Struct({
  harnesses: Schema.Array(AgentHarness),
  /** When the harness last probed its agents; null if none ever reported. */
  reportedAt: Schema.NullOr(Schema.String)
})

export type AgentCatalog = typeof AgentCatalog.Type

export const InferenceResult = Schema.Struct({
  text: Schema.String,
  model: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(Schema.Unknown),
  providerResponse: Schema.optional(Schema.Unknown),
  durationMs: Schema.optional(Schema.Int)
})

export type InferenceResult = typeof InferenceResult.Type

export const HarnessRegistration = Schema.Struct({
  id: HarnessId,
  name: Schema.String,
  kinds: Schema.Array(JobKind),
  accounts: Schema.Array(HhAccountId),
  /**
   * The device token in plaintext. It is present only in the `HarnessRegister`
   * response and is never stored or returned again.
   */
  token: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.String
})

export type HarnessRegistration = typeof HarnessRegistration.Type

/**
 * Счётчики очереди. Окна разные:
 * - `pending`, `leased`, `running`, `needsHuman`, `needsReconcile` - за всё время:
 *   застрявшая задача остаётся в счётчике, пока её не разобрали;
 * - `done`, `failed`, `dead` - только задачи, созданные за последние 24 часа.
 */
export const QueueStats = Schema.Struct({
  pending: Schema.Int,
  leased: Schema.Int,
  running: Schema.Int,
  /** За последние 24 часа. */
  done: Schema.Int,
  /** За последние 24 часа. */
  failed: Schema.Int,
  /** За последние 24 часа. */
  dead: Schema.Int,
  /** За всё время, без окна. */
  needsHuman: Schema.Int,
  /** За всё время, без окна. */
  needsReconcile: Schema.Int,
  /** Возраст самой старой ожидающей (`pending`) задачи. */
  oldestPendingAgeSeconds: Schema.Int
})

export type QueueStats = typeof QueueStats.Type

/** Сколько задач одной стадии. */
export const StageCount = Schema.Struct({
  stage: JobStage,
  count: Schema.Int
})

export type StageCount = typeof StageCount.Type

export const ConcurrencyHarness = Schema.Struct({
  id: HarnessId,
  name: Schema.String,
  /** Потоки харнесса (`OTBOR_HARNESS_CONCURRENCY`); null, пока он не сообщил. */
  slots: Schema.NullOr(Schema.Int),
  /** Его задачи в `leased`/`running`, браузерные и inference вместе. */
  busy: Schema.Int,
  lastSeenAt: Schema.NullOr(Schema.String)
})

export const ConcurrencyAccount = Schema.Struct({
  id: HhAccountId,
  name: Schema.String,
  /** Держатель неистёкшего `account_lease`. */
  holderHarnessId: Schema.NullOr(HarnessId),
  holderHarnessName: Schema.NullOr(Schema.String),
  /** Раньше этого момента следующая отправка аккаунта не выдастся (темп); null, если можно сейчас. */
  nextSubmitAt: Schema.NullOr(Schema.String),
  /** Отправки на паузе после капчи с этого момента; null, если идут. */
  submitBlockedAt: Schema.NullOr(Schema.String),
  /** Когда пауза снимется сама (пауза растёт при капчах подряд); null, если отправки идут. */
  submitRetryAt: Schema.NullOr(Schema.String),
  /** Когда hh в последний раз показал капчу; null, если ещё не показывал. */
  lastCaptchaAt: Schema.NullOr(Schema.String),
  /** Сколько капч за последние 24 часа. */
  captchas24h: Schema.Int,
  /** Сколько откликов otbor подтверждено после последней капчи (всего, если капчи не было). */
  submitsSinceCaptcha: Schema.Int,
  /** Почему остановлены: `captcha` - hh попросил капчу. */
  submitBlockReason: Schema.NullOr(Schema.String),
  /** Браузерные задачи в `leased`/`running` по стадиям. */
  running: Schema.Array(StageCount),
  browserRunning: Schema.Int,
  actingRunning: Schema.Int,
  /** Браузерные задачи в `pending`, которым уже пора, по стадиям. */
  pending: Schema.Array(StageCount),
  pendingTotal: Schema.Int,
  oldestPendingAgeSeconds: Schema.Int
})

export const QueueConcurrency = Schema.Struct({
  /** Браузерных задач аккаунта разом у одного харнесса (настройки пользователя). */
  browserCap: Schema.Int,
  /** Из них действующих: submit, letter_attach (настройки пользователя). */
  actingCap: Schema.Int,
  /** Минимум секунд между отправками одного аккаунта (настройки), без случайной надбавки. */
  submitIntervalSeconds: Schema.Int,
  /** Случайная надбавка к интервалу, процентов от него. */
  submitJitterPercent: Schema.Int,
  /** Не больше стольких отправок аккаунта за час; null - без лимита. */
  submitHourlyLimit: Schema.NullOr(Schema.Int),
  /** Сколько потоков харнессы должны держать (настройки). */
  harnessSlots: Schema.Int,
  /** Чтений формы аккаунта разом (настройки). */
  formReadConcurrency: Schema.Int,
  /** Минимум секунд между стартами чтений формы одного аккаунта (настройки). */
  formReadIntervalSeconds: Schema.Int,
  /** Случайная надбавка к интервалу чтений, процентов. */
  formReadJitterPercent: Schema.Int,
  /** Во сколько раз реже читать формы при блокировке капчей. */
  formReadBlockedFactor: Schema.Int,
  actingStages: Schema.Array(JobStage),
  harnesses: Schema.Array(ConcurrencyHarness),
  accounts: Schema.Array(ConcurrencyAccount),
  /** Браузерные задачи без аккаунта. */
  unassigned: Schema.Struct({ running: Schema.Array(StageCount), pending: Schema.Array(StageCount) }),
  inference: Schema.Struct({ running: Schema.Int, pending: Schema.Int })
})

export type QueueConcurrency = typeof QueueConcurrency.Type

export const HeartbeatResult = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.NullOr(Schema.String))
})

export type HeartbeatResult = typeof HeartbeatResult.Type

/**
 * Эпизод капчи: после какого числа откликов и за какое время hh показал капчу.
 * Строка открывается, когда капча остановила отправки аккаунта, и закрывается
 * (`resumedAt`), когда оператор их возобновил.
 */
export const CaptchaEpisode = Schema.Struct({
  id: Schema.String,
  hhAccountId: HhAccountId,
  captchaAt: Schema.String,
  resumedAt: Schema.NullOr(Schema.String),
  /** Подтверждённые отклики аккаунта между прошлым возобновлением и капчей. */
  submitsConfirmed: Schema.Int,
  firstSubmitAt: Schema.NullOr(Schema.String),
  lastSubmitAt: Schema.NullOr(Schema.String)
})

export type CaptchaEpisode = typeof CaptchaEpisode.Type

/**
 * Одна попытка распознать капчу, как её видит харнес: что ответила модель и
 * приняла ли hh. Приходит вместе с выходом задачи (`HarnessComplete`).
 */
export const CaptchaAttemptReport = Schema.Struct({
  /** Харнес, который читал картинку: `omlx`, `opencode`, `claude`... */
  harness: Schema.String,
  model: Schema.String,
  /** Номер попытки на этой капче, с 1. */
  attempt: Schema.Int,
  /** Что модель вернула; `null`, если ответа не было. */
  answer: Schema.NullOr(Schema.String),
  /** `solved` - капча ушла; `rejected` - hh показал её снова; `error` - модель не ответила. */
  outcome: Schema.Literals(["solved", "rejected", "error"]),
  durationMs: Schema.Int,
  error: Schema.NullOr(Schema.String)
})
export type CaptchaAttemptReport = typeof CaptchaAttemptReport.Type

/** Одна капча целиком: все попытки одной задачи, чем кончилось и за сколько. */
export const CaptchaSolveRecord = Schema.Struct({
  jobId: HarnessJobId,
  at: Schema.String,
  stage: Schema.String,
  hhAccountId: Schema.NullOr(HhAccountId),
  harness: Schema.String,
  model: Schema.String,
  attempts: Schema.Int,
  solved: Schema.Boolean,
  /** Ответ последней попытки. */
  answer: Schema.NullOr(Schema.String),
  durationMs: Schema.Int
})
export type CaptchaSolveRecord = typeof CaptchaSolveRecord.Type

/** Сводка по модели: сколько капч она видела, сколько решила и за сколько попыток. */
export const CaptchaModelStat = Schema.Struct({
  harness: Schema.String,
  model: Schema.String,
  captchas: Schema.Int,
  solved: Schema.Int,
  attempts: Schema.Int
})
export type CaptchaModelStat = typeof CaptchaModelStat.Type

/* -------------------------------------------------------------------------- */
