import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Config, Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

/**
 * The CLI is a client of the same RPC group the future web app will use. It
 * never talks to Postgres for product operations, so there is exactly one
 * place where a decision is enforced.
 */
export class Api extends Context.Service<Api, OtborApi>()("otbor/cli/Api") {}

export const ApiLayer = Layer.unwrap(
  Config.String("OTBOR_API_URL").pipe(
    Config.withDefault("http://127.0.0.1:3001/rpc"),
    Effect.map((url) =>
      Layer.effect(Api, RpcClient.make(OtborRpcs)).pipe(
        Layer.provide(RpcClient.layerProtocolHttp({ url })),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer)
      )
    )
  )
)
