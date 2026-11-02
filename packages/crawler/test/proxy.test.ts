import { describe, expect, test } from "bun:test"
import {
  pickNextNodes,
  proxyForUrl,
  proxyLabel,
  resolveProxyConfig
} from "../src/proxy/config.ts"

describe("proxy config", () => {
  test("accepts a ready HTTP proxy", () => {
    const config = resolveProxyConfig({ OTBOR_PROXY_URL: "127.0.0.1:7897" }, null)
    expect(config).not.toBeNull()
    expect(config!.source).toBe("endpoint")
    expect(config!.url).toBe("http://127.0.0.1:7897")
    expect(config!.origin).toBe("env")
    expect(proxyLabel(config)).toBe("127.0.0.1:7897")
  })

  test("builds a loopback endpoint for a subscription", () => {
    const config = resolveProxyConfig(
      {
        OTBOR_PROXY_SUB_URL: "https://sub.example.com/token",
        OTBOR_PROXY_PORT: "17890",
        OTBOR_PROXY_CONTROLLER_PORT: "19090",
        OTBOR_PROXY_GROUP: "otbor"
      },
      null
    )
    expect(config).not.toBeNull()
    expect(config!.source).toBe("subscription")
    expect(config!.url).toBe("http://127.0.0.1:17890")
    expect(config!.controller).toBe("http://127.0.0.1:19090")
    expect(config!.subscriptionUrl).toBe("https://sub.example.com/token")
    expect(config!.rotate).toBe("captcha")
  })

  test("does not proxy loopback", () => {
    const config = resolveProxyConfig({ OTBOR_PROXY_URL: "http://127.0.0.1:7897" }, null)
    expect(proxyForUrl(config, "http://127.0.0.1:3001/rpc")).toBeNull()
    expect(proxyForUrl(config, "https://hh.ru/vacancy/1")).toBe("http://127.0.0.1:7897")
  })

  test("rotates around the current node and skips modes", () => {
    expect(pickNextNodes(["DIRECT", "a", "b", "c"], "b", 4)).toEqual(["c", "a"])
  })
})
