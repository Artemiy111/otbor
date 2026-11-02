import {
  RPC_PATH,
  type ApplicationId,
  type OtborApi,
  OtborRpcs,
  type VacancyId
} from "@otbor/contract"
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

export const api = {
  health: () => call((client) => client.SystemHealth()),

  vacancies: (input: {
    readonly limit?: number
    readonly offset?: number
    readonly gate?: string
    readonly includeArchived?: boolean
  }) => call((client) => client.VacanciesList(input)),
  vacancy: (id: string) =>
    call((client) => client.VacanciesGet({ id: id as VacancyId })),
  titlePreview: (title: string) =>
    call((client) => client.TitlesPreview({ title })),

  decisions: (input: { readonly verdict?: string; readonly limit?: number; readonly offset?: number }) =>
    call((client) => client.DecisionsList(input)),

  applications: (input: { readonly state?: string; readonly limit?: number }) =>
    call((client) => client.ApplicationsList(input)),
  application: (id: string) =>
    call((client) => client.ApplicationsGet({ id: id as ApplicationId })),

  queueStats: () => call((client) => client.QueueStatsGet()),
  queueJobs: (input: { readonly status?: string; readonly limit?: number }) =>
    call((client) => client.QueueJobsList(input))
}

/** Domain errors have a tag first and sometimes no `message` getter. */
export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message !== "") return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    const parts = [record._tag, record.entity, record.id, record.operation, record.message]
      .filter((part): part is string => typeof part === "string" && part !== "")
    if (parts.length > 0) return parts.join(" · ")
  }
  return String(error)
}
