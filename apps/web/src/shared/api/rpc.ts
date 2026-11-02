import { RPC_PATH, type OtborApi, OtborRpcs } from "@otbor/contract"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

/**
 * The same RPC group and the same NDJSON wire format as `@otbor/cli`.
 * There is deliberately no REST adapter and no second API surface here.
 */
const endpoint = __OTBOR_API_URL__ === "" ? RPC_PATH : __OTBOR_API_URL__

export class Api extends Context.Service<Api, OtborApi>()("otbor/web/Api") {}

const ApiLayer = Layer.effect(Api, RpcClient.make(OtborRpcs)).pipe(
  Layer.provide(RpcClient.layerProtocolHttp({ url: endpoint })),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(FetchHttpClient.layer)
)

const runtime = ManagedRuntime.make(ApiLayer)

export const call = <A, E>(f: (api: OtborApi) => Effect.Effect<A, E>): Promise<A> =>
  runtime.runPromise(Effect.flatMap(Api, f))

export const apiEndpoint = endpoint
