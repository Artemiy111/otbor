import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ANALYSIS_QUESTIONS, buildAnalysisState } from "@otbor/domain"
import { Effect, Redacted } from "effect"
import { SystemOneClient, type SystemOneConfig, type SystemOneError } from "../src/services/SystemOneClient.ts"

interface Seen {
  method: string
  path: string
  auth: string | null
  body: any
}

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const seen: Array<Seen> = []
let reply: () => Response | Promise<Response> = () => Response.json({ answers: {} })
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        auth: request.headers.get("authorization"),
        body: await readJson(request)
      })
      return reply()
    }
  })
})
afterAll(() => server.stop(true))

const state = buildAnalysisState({
  title: "DevOps",
  areaName: "Москва",
  salaryFrom: null,
  salaryTo: null,
  salaryCurrency: null,
  workFormats: null,
  experienceCode: null,
  descriptionText: "Kubernetes",
  employer: null
})

const config = (patch: Partial<SystemOneConfig> = {}): SystemOneConfig => ({
  url: `http://127.0.0.1:${server.port}`,
  apiKey: Redacted.make("sekret-key"),
  model: "clef-flash-4bit",
  timeoutMs: 5_000,
  ...patch
})

const analyze = (patch?: Partial<SystemOneConfig>) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const client = yield* SystemOneClient
      return yield* client.analyze(state)
    }).pipe(Effect.provide(SystemOneClient.layerWith(config(patch))))
  )

const fail = async (patch?: Partial<SystemOneConfig>): Promise<SystemOneError> => {
  const exit = await Effect.runPromise(
    Effect.gen(function*() {
      const client = yield* SystemOneClient
      return yield* client.analyze(state)
    }).pipe(Effect.provide(SystemOneClient.layerWith(config(patch))), Effect.flip)
  )
  return exit
}

describe("SystemOneClient", () => {
  test("posts model, state and questions with the bearer key and decodes answers", async () => {
    seen.length = 0
    reply = () =>
      Response.json({
        answers: {
          overtime: { type: "noul", noul: 0.03 },
          role: { type: "choice", choice: "devops", confidence: 0.97, probabilities: { devops: 0.97 } },
          years_min: { type: "score", score: 2.8, confidence: 0.7 }
        },
        usage: { total_tokens: 321 }
      })

    const result = await analyze()
    expect(result.answers.overtime).toEqual({ type: "noul", noul: 0.03 })
    expect(result.tokens).toBe(321)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe("POST")
    expect(seen[0]!.path).toBe("/v1/systemone")
    expect(seen[0]!.auth).toBe("Bearer sekret-key")
    expect(seen[0]!.body.model).toBe("clef-flash-4bit")
    expect(seen[0]!.body.state.title).toBe("DevOps")
    expect(Object.keys(seen[0]!.body.questions)).toEqual(Object.keys(ANALYSIS_QUESTIONS))
  })

  test("no key means no Authorization header", async () => {
    seen.length = 0
    reply = () => Response.json({ answers: {} })
    await analyze({ apiKey: undefined })
    expect(seen[0]!.auth).toBeNull()
  })

  test("401 and 403 are unauthorized and never print the key", async () => {
    reply = () => new Response("bad key sekret-key", { status: 401 })
    const error = await fail()
    expect(error._tag).toBe("SystemOneError")
    expect(error.kind).toBe("unauthorized")
    expect(error.message).not.toContain("sekret-key")
    reply = () => new Response("no", { status: 403 })
    expect((await fail()).kind).toBe("unauthorized")
  })

  test("a refused connection and a 5xx are unreachable", async () => {
    reply = () => new Response("boom", { status: 503 })
    expect((await fail()).kind).toBe("unreachable")
    const refused = await fail({ url: "http://127.0.0.1:1" })
    expect(refused.kind).toBe("unreachable")
    expect(refused.message).not.toContain("sekret-key")
  })

  test("a slow server times out as unreachable", async () => {
    reply = async () => {
      await Bun.sleep(300)
      return Response.json({ answers: {} })
    }
    expect((await fail({ timeoutMs: 50 })).kind).toBe("unreachable")
  })

  test("a body that is not JSON or has malformed answers is bad_response", async () => {
    reply = () => new Response("<html>", { status: 200 })
    expect((await fail()).kind).toBe("bad_response")
    reply = () => Response.json({ nope: true })
    expect((await fail()).kind).toBe("bad_response")
    reply = () => Response.json({ answers: { role: { type: "choice", choice: 5 } } })
    expect((await fail()).kind).toBe("bad_response")
    reply = () => new Response("teapot", { status: 418 })
    expect((await fail()).kind).toBe("bad_response")
  })

  test("ping: a live server is reachable, a 5xx or a refused key is not, a dead port is not", async () => {
    const ping = (patch?: Partial<SystemOneConfig>) =>
      Effect.runPromise(
        Effect.gen(function*() {
          return yield* (yield* SystemOneClient).ping(1_000)
        }).pipe(Effect.provide(SystemOneClient.layerWith(config(patch))))
      )

    seen.length = 0
    reply = () => Response.json({ data: [] })
    expect(await ping()).toMatchObject({ reachable: true, error: null })
    expect(seen[0]).toMatchObject({ method: "GET", path: "/v1/models", auth: "Bearer sekret-key" })

    reply = () => new Response("no such route", { status: 404 })
    expect((await ping()).reachable).toBe(true)

    reply = () => new Response("boom", { status: 503 })
    expect(await ping()).toMatchObject({ reachable: false, error: "HTTP 503" })

    reply = () => new Response("nope", { status: 401 })
    const refused = await ping()
    expect(refused.reachable).toBe(false)
    expect(refused.error).not.toContain("sekret-key")

    const dead = await ping({ url: "http://127.0.0.1:1" })
    expect(dead.reachable).toBe(false)
    expect(dead.error).toContain("SystemOne недоступен")
  })
})
