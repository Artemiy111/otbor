import { describe, expect, test } from "bun:test"

describe("~/.otbor/openai.json", () => {
  test("сохранение, окружение переопределяет файл, удаление", async () => {
    const { mkdtempSync, statSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { readOpenAiStore, removeOpenAiEndpoint, upsertOpenAiEndpoint } = await import("../src/index.ts")
    const path = join(mkdtempSync(join(tmpdir(), "otbor-openai-")), "openai.json")

    expect(readOpenAiStore(path)).toEqual([])
    upsertOpenAiEndpoint({ id: "omlx", url: "http://a/v1", apiKey: "k" }, path)
    upsertOpenAiEndpoint({ id: "omlx", url: "http://b/v1" }, path)
    upsertOpenAiEndpoint({ id: "lm", url: "http://c/v1" }, path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readOpenAiStore(path).map((e) => [e.id, e.url])).toEqual([
      ["omlx", "http://b/v1"],
      ["lm", "http://c/v1"]
    ])

    expect(removeOpenAiEndpoint("omlx", path)).toBe(true)
    expect(removeOpenAiEndpoint("omlx", path)).toBe(false)
  })
})
