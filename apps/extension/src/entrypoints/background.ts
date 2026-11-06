import { defineBackground } from "wxt/utils/define-background"
import { browser } from "wxt/browser"
import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { CaptureReply, Reply, Request } from "@/messages.ts"
import { loadSettings } from "@/settings.ts"

/**
 * Every request goes through here, so hh.ru pages never talk to localhost
 * themselves. The extension speaks the same RPC group as the web app and the
 * CLI; there is no extension-only API surface.
 */
class Api extends Context.Service<Api, OtborApi>()("otbor/extension/Api") {}

let cached: { readonly url: string; readonly runtime: ManagedRuntime.ManagedRuntime<Api, never> } | null =
  null

const runtimeFor = (url: string) => {
  if (cached?.url === url) return cached.runtime
  const layer = Layer.effect(Api, RpcClient.make(OtborRpcs)).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url })),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer)
  )
  const runtime = ManagedRuntime.make(layer)
  void cached?.runtime.dispose()
  cached = { url, runtime }
  return runtime
}

const call = async <A, E>(f: (api: OtborApi) => Effect.Effect<A, E>): Promise<A> => {
  const { apiUrl } = await loadSettings()
  return runtimeFor(apiUrl).runPromise(Effect.flatMap(Api, f))
}

const lookup = (externalIds: ReadonlyArray<string>) =>
  call((api) => api.VacanciesLookup({ externalIds }))

const handle = async (request: Request): Promise<unknown> => {
  switch (request.type) {
    case "ping":
      return call((api) => api.SystemHealth())
    case "lookup":
      return lookup(request.externalIds)
    case "drafts":
      return call((api) => api.VacancyBrowserDrafts({ externalId: request.externalId, hhid: request.hhid }))
    case "record":
      return call((api) => api.ApplicationsRecordBrowserSubmit(request.payload))
    case "capture": {
      const result = await call((api) => api.VacanciesUpsert({ drafts: request.drafts }))
      if (request.evaluate) {
        const first = result.items[0]
        if (first !== undefined) {
          // The decision needs an hh account and a resume; without them the page still gets its facts.
          await call((api) => api.VacanciesEvaluate({ vacancyId: first.id })).catch(() => undefined)
        }
      }
      const items = await lookup(request.drafts.map((draft) => draft.externalId))
      const reply: CaptureReply = { inserted: result.inserted, updated: result.updated, items }
      return reply
    }
  }
}

const describe = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const e = error as { readonly message?: unknown; readonly _tag?: unknown }
    if (typeof e.message === "string" && e.message !== "") return e.message
    if (typeof e._tag === "string") return e._tag
  }
  return String(error)
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    handle(message).then(
      (value) => sendResponse({ ok: true, value } satisfies Reply<unknown>),
      (error) => sendResponse({ ok: false, error: describe(error) } satisfies Reply<unknown>)
    )
    return true
  })
})
