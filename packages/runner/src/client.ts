import type {
  AgentHarness,
  CaptchaAttemptReport,
  RunnerExit,
  RunnerId,
  RunnerJob,
  RunnerJobId,
  HeartbeatResult,
  HhAccountId,
  JobKind,
  LeaseId
} from "@otbor/contract"
import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Context, Effect, Layer, Predicate, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

export class RunnerGatewayError extends Schema.TaggedError<RunnerGatewayError>()(
  "RunnerGatewayError",
  {
    message: Schema.String
  }
) {}

export interface LeaseNextInput {
  readonly runnerId: RunnerId
  readonly token: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<HhAccountId>
  readonly waitSeconds?: number
  readonly concurrency?: number
}

export interface HeartbeatInput {
  readonly runnerId: RunnerId
  readonly token: string
  readonly jobId: RunnerJobId
  readonly leaseId: LeaseId
  readonly epoch: number
}

export interface CompleteInput extends HeartbeatInput {
  readonly exit: RunnerExit
  /** Попытки распознать капчу за время задачи (журнал ведёт облако). */
  readonly captcha?: ReadonlyArray<CaptchaAttemptReport>
}

export interface CompleteResult {
  readonly status: string
  readonly accepted: boolean
  readonly message?: string | null
}

export interface ReportCatalogInput {
  readonly runnerId: RunnerId
  readonly token: string
  readonly harnesses: ReadonlyArray<AgentHarness>
}

/**
 * The edge worker only needs four calls from the one RPC group. Keeping the
 * surface this small means the run loop cannot accidentally write product data:
 * it leases, it keeps the lease alive, and it reports one typed exit.
 */
export interface RunnerGatewayShape {
  readonly leaseNext: (
    input: LeaseNextInput
  ) => Effect.Effect<
    { readonly job: RunnerJob | null; readonly runnerSlots?: number | undefined },
    RunnerGatewayError
  >
  readonly heartbeat: (
    input: HeartbeatInput
  ) => Effect.Effect<HeartbeatResult, RunnerGatewayError>
  readonly complete: (
    input: CompleteInput
  ) => Effect.Effect<CompleteResult, RunnerGatewayError>
  /** What this runner can run: agents, models, efforts. */
  readonly reportCatalog: (
    input: ReportCatalogInput
  ) => Effect.Effect<{ readonly ok: boolean }, RunnerGatewayError>
}

const describe = (cause: unknown): string =>
  Predicate.isObject(cause) && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : String(cause)

const gatewayError =
  (operation: string) =>
  (cause: unknown): RunnerGatewayError =>
    new RunnerGatewayError({ message: `${operation}: ${describe(cause)}` })

const fromApi = (api: OtborApi): RunnerGatewayShape => ({
  leaseNext: (input) =>
    api.RunnerLeaseNext(input).pipe(Effect.mapError(gatewayError("lease"))),
  heartbeat: (input) =>
    api.RunnerHeartbeat(input).pipe(Effect.mapError(gatewayError("heartbeat"))),
  complete: (input) =>
    api.RunnerComplete(input).pipe(Effect.mapError(gatewayError("complete"))),
  reportCatalog: (input) =>
    api.HarnessReportCatalog(input).pipe(Effect.mapError(gatewayError("report catalog")))
})

/**
 * The same HTTP NDJSON transport as the operator CLI: the edge runner is just
 * another client of `OtborRpcs`, so there is exactly one API surface.
 */
export class RunnerGateway extends Context.Service<RunnerGateway, RunnerGatewayShape>()(
  "otbor/runner/RunnerGateway"
) {
  static readonly layer = (url: string): Layer.Layer<RunnerGateway> =>
    Layer.effect(
      RunnerGateway,
      Effect.map(RpcClient.make(OtborRpcs), fromApi)
    ).pipe(
      Layer.provide(RpcClient.layerProtocolHttp({ url })),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(FetchHttpClient.layer)
    )
}
