import { rotateProxy } from "@otbor/crawler"
import type { ProxyConfig } from "@otbor/crawler"
import { Context } from "effect"

/** A node the engine switched to, as returned by mihomo. */
export interface RotationOutcome {
  readonly node: string
  readonly delay: number | null
  readonly previous: string | null
}

/**
 * Switches the proxy to another node after a captcha. A test replaces this
 * reference so rotation can be exercised without a running mihomo engine.
 */
export const ProxyRotator = Context.Reference<
  (config: ProxyConfig) => Promise<RotationOutcome | null>
>("otbor/cloud/ProxyRotator", {
  defaultValue: () => (config) => rotateProxy(config)
})
