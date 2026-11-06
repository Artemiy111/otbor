import type { ApiError, ProxySettingsInput, ProxyStatus } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  clearProxyFile,
  loadProxyConfig,
  maskSubscription,
  proxyLabel,
  readProxyFile,
  resolveProxyConfig,
  startEngine,
  writeProxyFile,
  type ProxyConfig,
  type ProxyFileConfig
} from "@otbor/crawler"
import { Context, Effect, Layer } from "effect"

export interface ProxyServiceShape {
  /** Safe, local proxy state for the UI. Never returns subscription URLs. */
  readonly status: () => Effect.Effect<ProxyStatus, ApiError>
  /** Saves the proxy file; a subscription also restarts the local engine. */
  readonly configure: (input: ProxySettingsInput) => Effect.Effect<ProxyStatus, ApiError>
  readonly clear: () => Effect.Effect<ProxyStatus, ApiError>
}

const invalid = (error: unknown) =>
  new InvalidInput({
    message: `proxy config: ${error instanceof Error ? error.message : String(error)}`
  })

const toStatus = (config: ProxyConfig | null): ProxyStatus =>
  config === null
    ? {
        configured: false,
        source: null,
        label: "напрямую",
        origin: null,
        rotate: null,
        maxRotations: null,
        subscription: null
      }
    : {
        configured: true,
        source: config.source,
        label: proxyLabel(config),
        origin: config.origin,
        rotate: config.rotate,
        maxRotations: config.maxRotations,
        subscription: maskSubscription(config.subscriptionUrl)
      }

export class ProxyService extends Context.Service<ProxyService, ProxyServiceShape>()(
  "otbor/cloud/ProxyService"
) {
  static readonly layer = Layer.effect(
    ProxyService,
    Effect.sync(() => {
      const status: ProxyServiceShape["status"] = () =>
        Effect.try({ try: () => loadProxyConfig(), catch: invalid }).pipe(Effect.map(toStatus))

      const configure: ProxyServiceShape["configure"] = Effect.fn("ProxyService.configure")(
        function*(input) {
          const file = yield* Effect.try({
            try: (): ProxyFileConfig => {
              const next: ProxyFileConfig = { ...(readProxyFile() ?? {}) }
              const url = input.url?.trim()
              if (url !== undefined && url !== "") {
                if (input.kind === "endpoint") {
                  next.url = url
                  delete next.subscriptionUrl
                  delete next.port
                  delete next.controllerPort
                } else {
                  next.subscriptionUrl = url
                  delete next.url
                }
              } else if (
                (input.kind === "endpoint" ? next.url : next.subscriptionUrl) === undefined
              ) {
                throw new Error("нужна ссылка")
              }
              if (input.rotate !== undefined) next.rotate = input.rotate
              if (input.maxRotations !== undefined) next.maxRotations = input.maxRotations
              // Validate the resulting settings before touching the disk.
              if (resolveProxyConfig({}, next) === null) throw new Error("пустые настройки")
              return next
            },
            catch: invalid
          })
          yield* Effect.try({ try: () => writeProxyFile(file), catch: invalid })

          const config = yield* Effect.try({ try: () => loadProxyConfig(), catch: invalid })
          // mihomo reads its config only at start; recreate it in the
          // background so the request does not wait for Docker.
          if (config !== null && config.source === "subscription") {
            yield* Effect.tryPromise(() => startEngine(config, { timeoutMs: 60_000 })).pipe(
              Effect.catch((error) =>
                Effect.logWarning(`proxy engine restart failed: ${String(error)}`)
              ),
              Effect.forkDetach
            )
          }
          return toStatus(config)
        }
      )

      const clear: ProxyServiceShape["clear"] = Effect.fn("ProxyService.clear")(function*() {
        yield* Effect.try({ try: () => clearProxyFile(), catch: invalid })
        return yield* status()
      })

      return ProxyService.of({ status, configure, clear })
    })
  )
}
