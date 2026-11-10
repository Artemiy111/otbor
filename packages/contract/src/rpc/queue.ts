import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { JobKind, JobStage, JobStatus } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { HarnessId, HarnessJobId, HhAccountId, LeaseId } from "../ids.ts"
import {
  CaptchaAttemptReport,
  HarnessExit,
  HarnessJob,
  HarnessRegistration,
  HeartbeatResult,
  QueueConcurrency,
  QueueJob,
  QueueStats
} from "../models/index.ts"

export const QueueStatsGet = Rpc.make("QueueStatsGet", {
  payload: Schema.Struct({ kind: Schema.optional(JobKind) }),
  success: QueueStats,
  error: ApiError
})

/** Параллельность: потоки харнессов, потолки аккаунтов, кто что держит. */
export const QueueConcurrencyGet = Rpc.make("QueueConcurrencyGet", {
  payload: Schema.Struct({}),
  success: QueueConcurrency,
  error: ApiError
})

export const QueueJobsList = Rpc.make("QueueJobsList", {
  payload: Schema.Struct({
    status: Schema.optional(Schema.String),
    kind: Schema.optional(JobKind),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(HarnessJob),
  error: ApiError
})

/**
 * Список задач для страницы «Очереди»: постранично, с несколькими статусами и
 * стадиями сразу, с аккаунтом, вакансией, откликом и ошибкой на каждой задаче.
 * `QueueJobsList` остаётся для CLI и MCP.
 */
export const QueueJobsSearch = Rpc.make("QueueJobsSearch", {
  payload: Schema.Struct({
    /** Любой из статусов; пусто - все. */
    status: Schema.optional(Schema.Array(JobStatus)),
    /** Любая из стадий; пусто - все. */
    stage: Schema.optional(Schema.Array(JobStage)),
    kind: Schema.optional(JobKind),
    /** Подстрока в названии вакансии, имени аккаунта или тексте ошибки. */
    query: Schema.optional(Schema.String),
    /** 1-200, по умолчанию 50. */
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(QueueJob),
    /** Сколько задач подходит под фильтр без учёта страницы. */
    total: Schema.Int
  }),
  error: ApiError
})

export const HarnessRegister = Rpc.make("HarnessRegister", {
  payload: Schema.Struct({
    name: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId)
  }),
  success: HarnessRegistration,
  error: ApiError
})

export const HarnessLeaseNext = Rpc.make("HarnessLeaseNext", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    /** Device token from `HarnessRegister`; the only credential a harness has. */
    token: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId),
    waitSeconds: Schema.optional(Schema.Int),
    /** Потоки харнесса (`OTBOR_HARNESS_CONCURRENCY`); облако показывает их на странице очереди. */
    concurrency: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    job: Schema.NullOr(HarnessJob),
    /**
     * Сколько потоков харнесс должен держать по настройкам пользователя.
     * Харнесс подстраивает пул на лету; нет поля - остаётся его собственное
     * значение (`OTBOR_HARNESS_CONCURRENCY`).
     */
    harnessSlots: Schema.optional(Schema.Int)
  }),
  error: ApiError
})

export const HarnessHeartbeat = Rpc.make("HarnessHeartbeat", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    jobId: HarnessJobId,
    leaseId: LeaseId,
    epoch: Schema.Int
  }),
  success: HeartbeatResult,
  error: ApiError
})

export const HarnessComplete = Rpc.make("HarnessComplete", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    jobId: HarnessJobId,
    leaseId: LeaseId,
    epoch: Schema.Int,
    exit: HarnessExit,
    /** Попытки распознать капчу, пока шла задача (пусто, если капчи не было). */
    captcha: Schema.optional(Schema.Array(CaptchaAttemptReport))
  }),
  success: Schema.Struct({
    status: Schema.String,
    accepted: Schema.Boolean,
    message: Schema.optional(Schema.NullOr(Schema.String))
  }),
  error: ApiError
})

/**
 * Clears the harness token so the device can no longer lease, heartbeat or
 * complete work. Re-registering the harness issues a new token.
 */
export const HarnessRevoke = Rpc.make("HarnessRevoke", {
  payload: Schema.Struct({ harnessId: HarnessId }),
  success: Schema.Struct({
    harnessId: HarnessId,
    revoked: Schema.Boolean
  }),
  error: ApiError
})

/**
 * Харнесс берёт cookies аккаунта перед задачей и возвращает обновлённые после.
 * Аккаунт определяется по `sessionProfile` из задачи. Запись принимается, только
 * если `baseVersion` совпадает с текущей: более свежие cookies не затираются.
 */
export const HarnessSessionGet = Rpc.make("HarnessSessionGet", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    sessionProfile: Schema.String
  }),
  success: Schema.Struct({
    state: Schema.NullOr(Schema.String),
    version: Schema.NullOr(Schema.Int)
  }),
  error: ApiError
})

export const HarnessSessionPut = Rpc.make("HarnessSessionPut", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    sessionProfile: Schema.String,
    state: Schema.String,
    baseVersion: Schema.NullOr(Schema.Int)
  }),
  success: Schema.Struct({
    accepted: Schema.Boolean,
    version: Schema.NullOr(Schema.Int)
  }),
  error: ApiError
})
