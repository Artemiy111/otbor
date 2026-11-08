import { Schema } from "effect"
import { JobKind, JobStage, JobStatus } from "../enums.ts"
import { HarnessId, HarnessJobId, HhAccountId, LeaseId } from "../ids.ts"

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

export const QueueStats = Schema.Struct({
  pending: Schema.Int,
  leased: Schema.Int,
  running: Schema.Int,
  done: Schema.Int,
  failed: Schema.Int,
  dead: Schema.Int,
  needsHuman: Schema.Int,
  needsReconcile: Schema.Int,
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
  /** Отправки остановлены с этого момента, пока оператор не скажет «Продолжить»; null, если не остановлены. */
  submitBlockedAt: Schema.NullOr(Schema.String),
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

/* -------------------------------------------------------------------------- */
