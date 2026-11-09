import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  chatMessages,
  probeOpenAiEndpoint,
  resolveOpenAiEndpoints,
  runOpenAiExit,
  stripThinking
} from "../src/openai.ts"

/** Локальный сервер, притворяющийся oMLX: /models и /chat/completions. */
const serve = (handler: (request: Request) => Response | Promise<Response>) =>
  Bun.serve({ port: 0, fetch: handler })

const endpointFor = (server: { readonly port: number | undefined }, extra = {}) =>
  resolveOpenAiEndpoints({
    OTBOR_OPENAI_URL: `http://127.0.0.1:${server.port}/v1/`,
    ...extra
  })[0]!

describe("resolveOpenAiEndpoints", () => {
  test("один эндпоинт из OTBOR_OPENAI_URL, слеш в конце срезается", () => {
    const [endpoint] = resolveOpenAiEndpoints({
      OTBOR_OPENAI_URL: "http://127.0.0.1:8000/v1/",
      OTBOR_OPENAI_API_KEY: "secret"
    })
    expect(endpoint?.id).toBe("local")
    expect(endpoint?.baseUrl).toBe("http://127.0.0.1:8000/v1")
    expect(endpoint?.apiKey).toBeDefined()
    expect(String(endpoint?.apiKey)).not.toContain("secret")
  })

  test("JSON-массив добавляет и заменяет эндпоинты", () => {
    const endpoints = resolveOpenAiEndpoints({
      OTBOR_OPENAI_URL: "http://a/v1",
      OTBOR_OPENAI_ENDPOINTS: JSON.stringify([
        { id: "local", url: "http://b/v1" },
        { id: "omlx", name: "oMLX", url: "http://c/v1", timeoutSeconds: 10 }
      ])
    })
    expect(endpoints.map((e) => [e.id, e.baseUrl, e.timeoutSeconds])).toEqual([
      ["local", "http://b/v1", 300],
      ["omlx", "http://c/v1", 10]
    ])
  })

  test("без настроек эндпоинтов нет, битый JSON — ошибка", () => {
    expect(resolveOpenAiEndpoints({})).toEqual([])
    expect(() => resolveOpenAiEndpoints({ OTBOR_OPENAI_ENDPOINTS: "{" })).toThrow("not valid JSON")
  })
})

describe("chatMessages / stripThinking", () => {
  test("system отдельным сообщением, схема дописывается к запросу", () => {
    const messages = chatMessages({ prompt: "hi", system: "be brief", jsonSchema: { type: "object" } })
    expect(messages[0]).toEqual({ role: "system", content: "be brief" })
    expect(messages[1]?.content).toContain('{"type":"object"}')
  })

  test("думающий блок в начале ответа отбрасывается", () => {
    expect(stripThinking("<think>hmm</think>\n\nanswer")).toBe("answer")
    expect(stripThinking("plain")).toBe("plain")
  })
})

describe("probeOpenAiEndpoint", () => {
  test("модели берутся из /models", async () => {
    const server = serve((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/models")
      return Response.json({ data: [{ id: "qwen3" }, { id: "gemma" }] })
    })
    try {
      const { FetchHttpClient } = await import("effect/http")
      const harness = await Effect.runPromise(
        probeOpenAiEndpoint(endpointFor(server)).pipe(Effect.provide(FetchHttpClient.layer))
      )
      expect(harness.available).toBe(true)
      expect(harness.models.map((m) => m.id)).toEqual(["qwen3", "gemma"])
      expect(harness.defaultModel).toBe("qwen3")
    } finally {
      server.stop(true)
    }
  })

  test("недоступный сервер — available: false", async () => {
    const server = serve(() => new Response("nope", { status: 500 }))
    const endpoint = endpointFor(server)
    server.stop(true)
    const { FetchHttpClient } = await import("effect/http")
    const harness = await Effect.runPromise(
      probeOpenAiEndpoint(endpoint).pipe(Effect.provide(FetchHttpClient.layer))
    )
    expect(harness.available).toBe(false)
    expect(harness.error).not.toBeNull()
  })
})

describe("runOpenAiExit", () => {
  test("успех: prepared с текстом, моделью и usage; ключ уходит в Authorization", async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | undefined
    const server = serve(async (request) => {
      seen = {
        auth: request.headers.get("authorization"),
        body: (await request.json()) as Record<string, unknown>
      }
      return Response.json({
        model: "qwen3",
        choices: [{ message: { content: "<think>x</think> Привет" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      })
    })
    try {
      const exit = await Effect.runPromise(
        runOpenAiExit(
          endpointFor(server, { OTBOR_OPENAI_API_KEY: "k" }),
          { prompt: "hello", system: "sys", model: "qwen3", effort: "low" }
        )
      )
      expect(exit.tag).toBe("prepared")
      if (exit.tag !== "prepared") return
      expect(exit.artifacts).toMatchObject({
        text: "Привет",
        model: "qwen3",
        effort: "low",
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      })
      expect(seen?.auth).toBe("Bearer k")
      expect(seen?.body).toMatchObject({ model: "qwen3", stream: false, reasoning_effort: "low" })
      expect(seen?.body.messages).toEqual([
        { role: "system", content: "sys" },
        { role: "user", content: "hello" }
      ])
    } finally {
      server.stop(true)
    }
  })

  test("без модели, HTTP-ошибка и пустой ответ — inference_failed", async () => {
    const server = serve((request) => {
      const url = new URL(request.url)
      return url.searchParams.has("x")
        ? new Response()
        : Response.json({ error: { message: "model not found" } }, { status: 404 })
    })
    try {
      const endpoint = endpointFor(server)
      const noModel = await Effect.runPromise(runOpenAiExit(endpoint, { prompt: "p" }))
      expect(noModel).toMatchObject({ tag: "inference_failed" })
      const http = await Effect.runPromise(runOpenAiExit(endpoint, { prompt: "p", model: "m" }))
      expect(http).toMatchObject({ tag: "inference_failed" })
      expect(http.tag === "inference_failed" && http.message).toContain("model not found")
    } finally {
      server.stop(true)
    }

    const empty = serve(() => Response.json({ choices: [{ message: { content: "" } }] }))
    try {
      const exit = await Effect.runPromise(
        runOpenAiExit(endpointFor(empty), { prompt: "p", model: "m" })
      )
      expect(exit.tag).toBe("inference_failed")
    } finally {
      empty.stop(true)
    }
  })
})

describe("~/.otbor/openai.json", () => {
  test("сохранение, окружение переопределяет файл, удаление", async () => {
    const { mkdtempSync, statSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { readOpenAiStore, removeOpenAiEndpoint, upsertOpenAiEndpoint } = await import(
      "../src/openai-store.ts"
    )
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

    const merged = resolveOpenAiEndpoints(
      { OTBOR_OPENAI_URL: "http://env/v1", OTBOR_OPENAI_ID: "lm" },
      readOpenAiStore(path)
    )
    expect(merged.map((e) => [e.id, e.baseUrl])).toEqual([
      ["omlx", "http://b/v1"],
      ["lm", "http://env/v1"]
    ])

    expect(removeOpenAiEndpoint("omlx", path)).toBe(true)
    expect(removeOpenAiEndpoint("omlx", path)).toBe(false)
  })
})
