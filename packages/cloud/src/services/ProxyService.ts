import type { ApiError, ProxyStatus } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import { loadProxyConfig, proxyLabel } from "@otbor/crawler"
import { Context, Effect, Layer } from "effect"

export interface ProxyServiceShape {
  /** Safe, local proxy state for the UI. Never returns subscription URLs. */
  readonly status: () => Effect.Effect<ProxyStatus, ApiError>
}

export class ProxyService extends Context.Service<ProxyService, ProxyServiceShape>()(
  "otbor/cloud/ProxyService"
) {
  static readonly layer = Layer.effect(
    ProxyService,
    Effect.gen(function*() {
      const status: ProxyServiceShape["status"] = () =>
        Effect.try({
          try: () => loadProxyConfig(),
          catch: (error) =>
            new InvalidInput({
              message: `proxy config: ${error instanceof Error ? error.message : String(error)}`
            })
        }).pipe(
          Effect.map((config) =>
            config === null
              ? {
                  configured: false,
                  source: null,
                  label: "напрямую",
                  origin: null,
                  rotate: null,
                  maxRotations: null
                }
              : {
                  configured: true,
                  source: config.source,
                  label: proxyLabel(config),
                  origin: config.origin,
                  rotate: config.rotate,
                  maxRotations: config.maxRotations
                }
          )
        )

      return ProxyService.of({ status })
    })
  )
}
