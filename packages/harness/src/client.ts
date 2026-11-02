import type {
  HarnessExit,
  HarnessId,
  HarnessJob,
  HarnessJobId,
  HeartbeatResult,
  HhAccountId,
  JobKind,
  LeaseId
} from "@otbor/contract"
import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Context, Effect, Layer, Predicate, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

export class HarnessGatewayError extends Schema.TaggedError<HarnessGatewayError>()(
  "HarnessGatewayError",
  {
    message: Schema.String
  }
) {}

export interface LeaseNextInput {
  readonly harnessId: HarnessId
  readonly token: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<HhAccountId>
  readonly waitSeconds?: number
}

export interface HeartbeatInput {
  readonly harnessId: HarnessId
  readonly token: string
  readonly jobId: HarnessJobId
  readonly leaseId: LeaseId
  readonly epoch: number
}

export interface CompleteInput extends HeartbeatInput {
  readonly exit: HarnessExit
}

export interface CompleteResult {
  readonly status: string
  readonly accepted: boolean
  readonly message?: string | null
}

/**
 * The edge worker only needs three calls from the one RPC group. Keeping the
 * surface this small means the run loop cannot accidentally write product data:
 * it leases, it keeps the lease alive, and it reports one typed exit.
 */
export interface HarnessGatewayShape {
  readonly leaseNext: (
    input: LeaseNextInput
  ) => Effect.Effect<{ readonly job: HarnessJob | null }, HarnessGatewayError>
  readonly heartbeat: (
    input: HeartbeatInput
  ) => Effect.Effect<HeartbeatResult, HarnessGatewayError>
  readonly complete: (
    input: CompleteInput
  ) => Effect.Effect<CompleteResult, HarnessGatewayError>
}

const describe = (cause: unknown): string =>
  Predicate.isObject(cause) && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : String(cause)

const gatewayError =
  (operation: string) =>
  (cause: unknown): HarnessGatewayError =>
    new HarnessGatewayError({ message: `${operation}: ${describe(cause)}` })

const fromApi = (api: OtborApi): HarnessGatewayShape => ({
  leaseNext: (input) =>
    api.HarnessLeaseNext(input).pipe(Effect.mapError(gatewayError("lease"))),
  heartbeat: (input) =>
    api.HarnessHeartbeat(input).pipe(Effect.mapError(gatewayError("heartbeat"))),
  complete: (input) =>
    api.HarnessComplete(input).pipe(Effect.mapError(gatewayError("complete")))
})

/**
 * The same HTTP NDJSON transport as the operator CLI: the edge harness is just
 * another client of `OtborRpcs`, so there is exactly one API surface.
 */
export class HarnessGateway extends Context.Service<HarnessGateway, HarnessGatewayShape>()(
  "otbor/harness/HarnessGateway"
) {
  static readonly layer = (url: string): Layer.Layer<HarnessGateway> =>
    Layer.effect(
      HarnessGateway,
      Effect.map(RpcClient.make(OtborRpcs), fromApi)
    ).pipe(
      Layer.provide(RpcClient.layerProtocolHttp({ url })),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(FetchHttpClient.layer)
    )
}
