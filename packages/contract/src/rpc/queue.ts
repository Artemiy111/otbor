import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { JobKind, JobStage, JobStatus } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { RunnerId, RunnerJobId, HhAccountId, LeaseId } from "../ids.ts"
import {
  CaptchaAttemptReport,
  RunnerExit,
  RunnerJob,
  RunnerRegistration,
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
  success: Schema.Array(RunnerJob),
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

export const RunnerRegister = Rpc.make("RunnerRegister", {
  payload: Schema.Struct({
    name: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId)
  }),
  success: RunnerRegistration,
  error: ApiError
})

export const RunnerLeaseNext = Rpc.make("RunnerLeaseNext", {
  payload: Schema.Struct({
    runnerId: RunnerId,
    /** Device token from `RunnerRegister`; the only credential a runner has. */
    token: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId),
    waitSeconds: Schema.optional(Schema.Int),
    /** Потоки раннера (`OTBOR_RUNNER_CONCURRENCY`); облако показывает их на странице очереди. */
    concurrency: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    job: Schema.NullOr(RunnerJob),
    /**
     * Сколько потоков харнесс должен держать по настройкам пользователя.
     * Харнесс подстраивает пул на лету; нет поля - остаётся его собственное
     * значение (`OTBOR_RUNNER_CONCURRENCY`).
     */
    runnerSlots: Schema.optional(Schema.Int)
  }),
  error: ApiError
})

export const RunnerHeartbeat = Rpc.make("RunnerHeartbeat", {
  payload: Schema.Struct({
    runnerId: RunnerId,
    token: Schema.String,
    jobId: RunnerJobId,
    leaseId: LeaseId,
    epoch: Schema.Int
  }),
  success: HeartbeatResult,
  error: ApiError
})

export const RunnerComplete = Rpc.make("RunnerComplete", {
  payload: Schema.Struct({
    runnerId: RunnerId,
    token: Schema.String,
    jobId: RunnerJobId,
    leaseId: LeaseId,
    epoch: Schema.Int,
    exit: RunnerExit,
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
 * Clears the runner token so the device can no longer lease, heartbeat or
 * complete work. Re-registering the runner issues a new token.
 */
export const RunnerRevoke = Rpc.make("RunnerRevoke", {
  payload: Schema.Struct({ runnerId: RunnerId }),
  success: Schema.Struct({
    runnerId: RunnerId,
    revoked: Schema.Boolean
  }),
  error: ApiError
})

/**
 * Харнесс берёт cookies аккаунта перед задачей и возвращает обновлённые после.
 * Аккаунт определяется по `sessionProfile` из задачи. Запись принимается, только
 * если `baseVersion` совпадает с текущей: более свежие cookies не затираются.
 */
export const RunnerSessionGet = Rpc.make("RunnerSessionGet", {
  payload: Schema.Struct({
    runnerId: RunnerId,
    token: Schema.String,
    sessionProfile: Schema.String
  }),
  success: Schema.Struct({
    state: Schema.NullOr(Schema.String),
    version: Schema.NullOr(Schema.Int)
  }),
  error: ApiError
})

export const RunnerSessionPut = Rpc.make("RunnerSessionPut", {
  payload: Schema.Struct({
    runnerId: RunnerId,
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
