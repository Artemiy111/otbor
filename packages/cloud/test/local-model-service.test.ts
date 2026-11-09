import { describe, expect, test } from "bun:test"
import { mergeServer, toServer } from "../src/services/LocalModelService.ts"

describe("mergeServer", () => {
  test("пустой ключ сохраняет старый, clearKey стирает", () => {
    const existing = { id: "omlx", url: "http://a/v1", apiKey: "old" }
    expect(mergeServer({ id: "omlx", url: "http://b/v1" }, existing).apiKey).toBe("old")
    expect(mergeServer({ id: "omlx", url: "http://b/v1", apiKey: "  " }, existing).apiKey).toBe("old")
    expect(mergeServer({ id: "omlx", url: "http://b/v1", apiKey: "new" }, existing).apiKey).toBe("new")
    expect(mergeServer({ id: "omlx", url: "http://b/v1", clearKey: true }, existing).apiKey).toBeUndefined()
  })

  test("плохой id, занятый id и не-http адрес отклоняются", () => {
    expect(() => mergeServer({ id: "a b", url: "http://x/v1" }, undefined)).toThrow("id")
    expect(() => mergeServer({ id: "Claude", url: "http://x/v1" }, undefined)).toThrow("занят")
    expect(() => mergeServer({ id: "omlx", url: "ftp://x" }, undefined)).toThrow("http")
    expect(() => mergeServer({ id: "omlx", url: "not a url" }, undefined)).toThrow("http")
  })

  test("наружу ключ не уходит, только hasKey", () => {
    const server = toServer({ id: "omlx", url: "http://a/v1", apiKey: "secret" })
    expect(server).toEqual({ id: "omlx", name: "omlx", url: "http://a/v1", hasKey: true })
    expect(JSON.stringify(server)).not.toContain("secret")
  })
})
