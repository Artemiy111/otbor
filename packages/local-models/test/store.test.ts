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

describe("probeLocalModel", () => {
  const serve = (handler: (request: Request) => Response) => Bun.serve({ port: 0, fetch: handler })

  test("живой сервер: число моделей и задержка, ключ уходит в заголовке", async () => {
    const { probeLocalModel } = await import("../src/index.ts")
    let auth = null as string | null
    const server = serve((request) => {
      auth = request.headers.get("authorization")
      return Response.json({ data: [{ id: "a" }, { id: "b" }] })
    })
    try {
      const probe = await probeLocalModel({ id: "x", url: `http://127.0.0.1:${server.port}/v1/`, apiKey: "k" })
      expect(probe).toMatchObject({ ok: true, models: 2, error: null })
      expect(probe.latencyMs).toBeGreaterThanOrEqual(0)
      expect(auth).toBe("Bearer k")
    } finally {
      server.stop(true)
    }
  })

  test("401, пустой список и закрытый порт — ok: false", async () => {
    const { probeLocalModel } = await import("../src/index.ts")
    const denied = serve(() => new Response("no", { status: 401 }))
    const empty = serve(() => Response.json({ data: [] }))
    try {
      const refused = await probeLocalModel({ id: "x", url: `http://127.0.0.1:${denied.port}/v1` })
      expect(refused).toMatchObject({ alive: true, ok: false })
      expect(refused.error).toContain("ключ")
      expect((await probeLocalModel({ id: "x", url: `http://127.0.0.1:${empty.port}/v1` })).ok).toBe(false)
    } finally {
      denied.stop(true)
      empty.stop(true)
    }
    const closed = serve(() => new Response())
    const url = `http://127.0.0.1:${closed.port}/v1`
    closed.stop(true)
    const probe = await probeLocalModel({ id: "x", url, apiKey: "sekret" })
    expect(probe).toMatchObject({ alive: false, ok: false })
    expect(probe.latencyMs).toBeNull()
    expect(probe.error).not.toContain("sekret")
  })
})
