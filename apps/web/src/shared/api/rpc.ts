import { RPC_PATH, type OtborApi, OtborRpcs } from "@otbor/contract"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpSerialization, OtlpTracer } from "effect/observability"
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

/**
 * Трейсы браузера: RPC-клиент создаёт спан на каждый вызов и передаёт его
 * серверу, так что в Tempo вызов из интерфейса и его обработка на сервере
 * видны одним трейсом. Слой пуст, пока экспорт не включён при сборке.
 */
const TelemetryLayer = __OTBOR_OTLP_URL__ === ""
  ? Layer.empty
  : OtlpTracer.layer({
    url: `${__OTBOR_OTLP_URL__}/v1/traces`,
    resource: { serviceName: "otbor-web", attributes: { "service.namespace": "otbor" } }
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  )

const runtime = ManagedRuntime.make(Layer.provideMerge(ApiLayer, TelemetryLayer))

export const call = <A, E>(f: (api: OtborApi) => Effect.Effect<A, E>): Promise<A> =>
  runtime.runPromise(Effect.flatMap(Api, f))

export const apiEndpoint = endpoint
