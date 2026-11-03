import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Config, Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

export const DEFAULT_API_URL = "http://127.0.0.1:3001/rpc"

/**
 * The MCP server is a client of the same `OtborRpcs` group as the CLI and the
 * web app. It never touches Postgres, so a decision is enforced in one place.
 * `url` is kept next to the client only to make "API is down" errors useful.
 */
export class Api extends Context.Service<Api, {
  readonly rpc: OtborApi
  readonly url: string
}>()("otbor/mcp/Api") {}

export const apiLayerFor = (url: string) =>
  Layer.effect(
    Api,
    Effect.map(RpcClient.make(OtborRpcs), (rpc) => Api.of({ rpc, url }))
  ).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url })),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer)
  )

/** `OTBOR_API_URL`, defaulting to the local server. Building it never connects. */
export const ApiLayer = Layer.unwrap(
  Config.String("OTBOR_API_URL").pipe(
    Config.withDefault(DEFAULT_API_URL),
    Effect.map(apiLayerFor)
  )
)
