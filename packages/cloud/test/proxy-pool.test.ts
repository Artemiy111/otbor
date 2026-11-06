import { describe, expect, test } from "bun:test"
import { resolveProxyConfig, workerProxyConfig } from "@otbor/crawler"
import { Effect } from "effect"
import { proxyWorkerCount, withProxyWorker } from "../src/services/proxyPool.ts"

const endpoint = resolveProxyConfig({}, { url: "http://127.0.0.1:7890", workers: 5 })!

describe("proxy workers", () => {
  test("a ready endpoint is a single worker", () => {
    expect(proxyWorkerCount(endpoint)).toBe(1)
    expect(proxyWorkerCount(null)).toBe(1)
    expect(workerProxyConfig(endpoint, 3)).toBe(endpoint)
  })

  test("a subscription gives each worker its own port and group", () => {
    const sub = resolveProxyConfig({}, { subscriptionUrl: "https://example.com/s", workers: 3 })!
    expect(proxyWorkerCount(sub)).toBe(3)
    const a = workerProxyConfig(sub, 0)
    const b = workerProxyConfig(sub, 1)
    expect(a.url).not.toBe(b.url)
    expect(a.group).toBe("otbor-1")
    expect(b.group).toBe("otbor-2")
  })

  test("without a subscription the worker runs on the config as is", async () => {
    const seen = await Effect.runPromise(withProxyWorker(endpoint, (worker, slot) => Effect.succeed([worker, slot])))
    expect(seen).toEqual([endpoint, 0])
  })
})
