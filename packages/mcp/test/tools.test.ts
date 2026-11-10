import type { DecisionRecord, OtborApi, VacancyDetail } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { McpProtocol, McpTest } from "effect/ai"
import { Api, apiLayerFor } from "../src/api.ts"
import { OtborReadHandlers } from "../src/handlers.ts"
import { OtborReadRegistration } from "../src/server.ts"
import { OtborReadToolkit } from "../src/tools.ts"


const id = (n: number) => `0190c8f5-8c2b-7abc-8def-${n.toString().padStart(12, "0")}`

const decision = (
  n: number,
  over: Partial<DecisionRecord> & { vacancyN: number }
): DecisionRecord => ({
  id: id(1000 + n),
  userId: "u",
  vacancyId: id(over.vacancyN),
  vacancyTitle: `Vacancy ${over.vacancyN}`,
  verdict: "apply",
  fit: 70,
  priority: 10,
  reasons: [
    { code: "skill_match", detail: "typescript", weight: 3 },
    { code: "remote", weight: 8 }
  ],
  policyVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  ...over
} as unknown as DecisionRecord)

const detail = (n: number): VacancyDetail => ({
  vacancy: {
    id: id(n),
    source: "hh",
    externalId: String(9000 + n),
    canonicalUrl: `https://hh.ru/vacancy/${9000 + n}`,
    title: `Vacancy ${n}`,
    employerName: `Employer ${n}`,
    salaryFrom: 100000,
    salaryTo: 200000,
    salaryCurrency: "RUR",
    seniority: "senior",
    experienceCode: "between3And6",
    workFormats: ["remote"],
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    blacklisted: false,
    blacklistLayers: []
  },
  descriptionText: "x".repeat(500),
  skills: ["TypeScript"],
  keywords: []
} as unknown as VacancyDetail)

const MAIN = id(500)
const SIDE = id(501)

const accounts = [
  { id: MAIN, label: "main", isDefault: true, sessionProfile: "p1", firstName: "Ivan", lastName: "Petrov" },
  { id: SIDE, label: "Side", isDefault: false, sessionProfile: null, firstName: null, lastName: null }
]

const application = (n: number, hhAccountId: string, state: string) => ({
  id: id(2000 + n),
  userId: "u",
  hhAccountId,
  vacancyId: id(n),
  vacancyTitle: `Vacancy ${n}`,
  employerName: null,
  state,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
})

const applications = [
  application(1, MAIN, "draft"),
  application(2, MAIN, "submitted"),
  application(3, SIDE, "draft")
]

const decisions = [
  decision(1, { vacancyN: 1, priority: 20, fit: 60, hhAccountId: MAIN } as never),
  decision(2, { vacancyN: 2, priority: 90, fit: 85, hhAccountId: MAIN } as never),
  decision(3, { vacancyN: 3, priority: 50, fit: 40, hhAccountId: SIDE } as never),
  // older duplicate of vacancy 2 with a higher priority: the newest must win
  decision(4, { vacancyN: 2, priority: 99, fit: 99, hhAccountId: MAIN } as never),
  decision(5, { vacancyN: 4, priority: 70, fit: 90, verdict: "skip", hhAccountId: SIDE } as never)
]

const seen: Array<unknown> = []
const fake = {
  DecisionsList: (payload: {
    verdict?: string
    offset?: number
    limit?: number
    minFit?: number
    maxFit?: number
    sort?: string
    orderBy?: string
    latestPerVacancy?: boolean
    hhAccountId?: string
  }) => {
    seen.push(payload)
    // Mirrors the server: the list is newest-first; latestPerVacancy keeps the
    // first row per vacancy, filters apply to the survivor, then order + limit.
    let rows = [...decisions]
    if (payload.latestPerVacancy === true) {
      const kept = new Map<string, DecisionRecord>()
      for (const d of rows) if (!kept.has(d.vacancyId)) kept.set(d.vacancyId, d)
      rows = [...kept.values()]
    }
    rows = rows.filter((d) =>
      (payload.verdict === undefined || d.verdict === payload.verdict) &&
      (payload.minFit === undefined || d.fit >= payload.minFit) &&
      (payload.maxFit === undefined || d.fit <= payload.maxFit) &&
      (payload.hhAccountId === undefined || d.hhAccountId === payload.hhAccountId)
    )
    if (payload.sort === "fit") rows.sort((a, b) => b.fit - a.fit)
    else if (payload.orderBy === "priority") rows.sort((a, b) => b.priority - a.priority || b.fit - a.fit)
    return Effect.succeed(rows.slice(payload.offset ?? 0, (payload.offset ?? 0) + (payload.limit ?? 50)))
  },
  HhAccountsList: () => Effect.succeed(accounts),
  ApplicationsList: (payload: { hhAccountId?: string; state?: string }) =>
    Effect.succeed(
      applications.filter((a) =>
        (payload.hhAccountId === undefined || a.hhAccountId === payload.hhAccountId) &&
        (payload.state === undefined || a.state === payload.state)
      )
    ),
  VacanciesGet: ({ id: vacancyId }: { id: string }) => {
    const n = Number(vacancyId.slice(-12))
    return n === 3 ? Effect.fail({ _tag: "NotFound", entity: "vacancy", id: vacancyId }) : Effect.succeed(detail(n))
  },
  VacancyAnalysisGet: ({ vacancyId }: { vacancyId: string }) =>
    Effect.succeed(
      vacancyId.endsWith("000000000001")
        ? {
            vacancyId,
            promptVersion: "a4",
            inputHash: "h",
            model: "clef-flash-4bit",
            threshold: 0.8,
            latencyMs: 1000,
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
            facts: {
              role: { value: "devops", confidence: 0.97 },
              testTask: null,
              redFlags: { stress: null, scam: { value: false, confidence: 0.9 } }
            }
          }
        : null
    ),
  FitJudgementGet: ({ vacancyId }: { vacancyId: string }) =>
    Effect.succeed(
      vacancyId.endsWith("000000000007")
        ? null
        : {
            id: id(7000),
            vacancyId,
            resumeId: id(8000),
            vacancyContentHash: "h",
            resumeHash: "r",
            promptVersion: "fit-v1",
            source: "llm",
            status: "done",
            judgement: {
              fit: 72,
              confidence: 0.8,
              verdict: "ok",
              reasons: ["Kubernetes shown"],
              disqualifiers: ["no Terraform"],
              quotes: ["опыт Kubernetes"]
            },
            model: "m",
            inferenceJobId: null,
            error: null,
            current: false,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z"
          }
    ),
  SystemHealth: () => Effect.succeed({ status: "ok", version: "t", database: true, now: "now" })
} as unknown as OtborApi

const FakeApi = Layer.succeed(Api, Api.of({ rpc: fake, url: "http://fake/rpc" }))

const withClient = <A, E>(
  layer: Layer.Layer<Api>,
  use: (client: McpTest.Client) => Effect.Effect<A, E>,
  registration: typeof OtborReadRegistration = OtborReadRegistration
) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const client = yield* McpTest.makeClient(
        registration.pipe(Layer.provide(layer)),
        { protocols: [McpProtocol.v2025_11_25] }
      )
      return yield* use(client)
    }).pipe(Effect.scoped) as Effect.Effect<A, never>
  )

describe("mcp tools", () => {
  test("registers read-only tools with snake_case names", async () => {
    const tools = await withClient(FakeApi, (c) => c.listTools())
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain("vacancies_top")
    expect(names).toContain("vacancy_get")
    expect(names.every((n) => /^[a-z]+(_[a-z]+)*$/.test(n))).toBe(true)
    expect(tools.tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.every((t) => t.annotations?.destructiveHint === false)).toBe(true)
  })

  test("fit_get returns the judgement with its staleness, or null", async () => {
    const found = await withClient(FakeApi, (c) => c.callTool({ name: "fit_get", arguments: { id: id(2) } }))
    const body = found.structuredContent as {
      judgement: { fit: number; current: boolean; disqualifiers: Array<string>; verdict: string } | null
    }
    expect(body.judgement?.fit).toBe(72)
    expect(body.judgement?.current).toBe(false)
    expect(body.judgement?.verdict).toBe("ok")
    expect(body.judgement?.disqualifiers).toEqual(["no Terraform"])

    const none = await withClient(FakeApi, (c) => c.callTool({ name: "fit_get", arguments: { id: id(7) } }))
    expect((none.structuredContent as { judgement: unknown }).judgement).toBeNull()
  })

  test("vacancies_top ranks by priority, dedupes per vacancy, defaults to apply", async () => {
    seen.length = 0
    const result = await withClient(FakeApi, (c) => c.callTool({ name: "vacancies_top", arguments: {} }))
    expect(result.isError).toBeFalsy()
    const out = result.structuredContent as {
      items: Array<{ rank: number; vacancyId: string; title: string; employer: string | null; salary: string | null; reasons: Array<string>; url: string | null }>
      considered: number
    }
    // vacancy 2 (newest decision wins: first in newest-first list is #2 priority 90), then 3, then 1
    expect(out.items.map((i) => i.vacancyId)).toEqual([id(2), id(3), id(1)])
    expect(out.items.map((i) => i.rank)).toEqual([1, 2, 3])
    expect(out.considered).toBe(3)
    // one server-side call: ranked, newest decision per vacancy, no client scan
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ verdict: "apply", orderBy: "priority", latestPerVacancy: true, limit: 10 })
    expect(out.items[0]?.employer).toBe("Employer 2")
    expect(out.items[0]?.salary).toBe("100000-200000 RUR")
    expect(out.items[0]?.url).toBe("https://hh.ru/vacancy/9002")
    // strongest reason (remote, weight 8) first
    expect(out.items[0]?.reasons[0]).toBe("remote (8)")
    // vacancy 3 failed to load: falls back to the decision title, no crash
    expect(out.items[1]?.title).toBe("Vacancy 3")
    expect(out.items[1]?.employer).toBeNull()
  })

  test("vacancies_top honours limit, minFit and verdict", async () => {
    const limited = await withClient(FakeApi, (c) =>
      c.callTool({ name: "vacancies_top", arguments: { limit: 1 } }))
    expect((limited.structuredContent as { items: Array<unknown> }).items).toHaveLength(1)

    const fit = await withClient(FakeApi, (c) =>
      c.callTool({ name: "vacancies_top", arguments: { minFit: 50 } }))
    expect((fit.structuredContent as { items: Array<{ vacancyId: string }> }).items.map((i) => i.vacancyId))
      .toEqual([id(2), id(1)])

    const skip = await withClient(FakeApi, (c) =>
      c.callTool({ name: "vacancies_top", arguments: { verdict: "skip" } }))
    expect((skip.structuredContent as { items: Array<{ vacancyId: string }> }).items.map((i) => i.vacancyId))
      .toEqual([id(4)])
  })

  test("vacancies_search forwards filter, bounds and sort, and explains each hit", async () => {
    seen.length = 0
    const filter = {
      rules: [
        { field: "seniority", op: "in", value: ["middle", "unknown"] },
        { field: "skills", op: "contains", value: "kubernetes" }
      ]
    }
    const result = await withClient(FakeApi, (c) =>
      c.callTool({
        name: "vacancies_search",
        arguments: { filter, maxFit: 70, sort: "fit", offset: 0, limit: 5, verdict: "apply" }
      }))
    expect(result.isError).toBeFalsy()
    const out = result.structuredContent as {
      items: Array<{ vacancyId: string; fit: number; seniority: string | null; experience: string | null; skills: Array<string>; employer: string | null; salary: string | null; url: string | null }>
      returned: number
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ verdict: "apply", sort: "fit", maxFit: 70, limit: 5, latestPerVacancy: true, filter })
    expect(out.items.map((i) => i.vacancyId)).toEqual([id(1), id(3)])
    expect(out.items[0]).toMatchObject({
      fit: 60,
      seniority: "senior",
      experience: "between3And6",
      skills: ["TypeScript"],
      employer: "Employer 1",
      url: "https://hh.ru/vacancy/9001"
    })
    expect(out.returned).toBe(2)
  })

  test("vacancies_search describes the filter vocabulary and unknown seniority", async () => {
    const tools = await withClient(FakeApi, (c) => c.listTools())
    const tool = tools.tools.find((t) => t.name === "vacancies_search")
    const description = tool?.description ?? ""
    for (const word of ["employer_vacancies", "employer_reviews", "seniority", "unknown", "kubernetes", "not_in", "published_days"]) {
      expect(description).toContain(word)
    }
  })

  test("accounts_list shows names and application counts per state", async () => {
    const result = await withClient(FakeApi, (c) => c.callTool({ name: "accounts_list", arguments: {} }))
    const out = result.structuredContent as {
      items: Array<{ id: string; name: string; label: string; isDefault: boolean; applications: Record<string, number> }>
    }
    expect(out.items.map((a) => a.name)).toEqual(["Ivan Petrov", "Side"])
    expect(out.items[0]).toMatchObject({ label: "main", isDefault: true, applications: { draft: 1, submitted: 1 } })
    expect(out.items[1]?.applications).toEqual({ draft: 1 })
  })

  test("applications and decisions carry the account and filter by it (id, prefix, name, label)", async () => {
    const all = await withClient(FakeApi, (c) => c.callTool({ name: "applications_list", arguments: {} }))
    const items = (all.structuredContent as { items: Array<{ account: { id: string; name: string } }> }).items
    expect(items.map((i) => i.account.name)).toEqual(["Ivan Petrov", "Ivan Petrov", "Side"])

    for (const account of [SIDE, SIDE.toUpperCase(), "side", "SIDE"]) {
      const one = await withClient(FakeApi, (c) => c.callTool({ name: "applications_list", arguments: { account } }))
      expect((one.structuredContent as { returned: number }).returned).toBe(1)
    }
    const byName = await withClient(FakeApi, (c) =>
      c.callTool({ name: "decisions_list", arguments: { account: "ivan petrov" } }))
    const decided = (byName.structuredContent as { items: Array<{ account: { name: string } | null }> }).items
    expect(decided).toHaveLength(3)
    expect(decided.every((d) => d.account?.name === "Ivan Petrov")).toBe(true)

    const top = await withClient(FakeApi, (c) => c.callTool({ name: "vacancies_top", arguments: { account: "side" } }))
    expect((top.structuredContent as { items: Array<{ vacancyId: string; account: { name: string } }> }).items)
      .toMatchObject([{ vacancyId: id(3), account: { name: "Side" } }])
  })

  test("vacancy_get carries a compact analysis: confident facts only, the rest listed as unknown", async () => {
    const result = await withClient(FakeApi, (c) => c.callTool({ name: "vacancy_get", arguments: { id: id(1) } }))
    const analysis = (result.structuredContent as { analysis: { facts: Record<string, unknown>; unknown: Array<string> } }).analysis
    expect(analysis.facts.role).toEqual({ value: "devops", confidence: 0.97 })
    expect(analysis.facts["redFlag.scam"]).toEqual({ value: false, confidence: 0.9 })
    expect(analysis.unknown).toContain("testTask")
    expect(analysis.unknown).toContain("redFlag.stress")
    expect("testTask" in analysis.facts).toBe(false)

    const none = await withClient(FakeApi, (c) => c.callTool({ name: "vacancy_get", arguments: { id: id(2) } }))
    expect((none.structuredContent as { analysis: unknown }).analysis).toBeNull()
  })

  test("an unknown account is a clear error listing the accounts", async () => {
    const result = await withClient(FakeApi, (c) =>
      c.callTool({ name: "applications_list", arguments: { account: "nobody" } }))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("no hh account matches")
    expect(JSON.stringify(result.content)).toContain("Ivan Petrov")
  })

  test("system_health returns the api url", async () => {
    const result = await withClient(FakeApi, (c) => c.callTool({ name: "system_health", arguments: {} }))
    expect((result.structuredContent as { apiUrl: string }).apiUrl).toBe("http://fake/rpc")
  })

  test("typed API errors become a readable tool error", async () => {
    const result = await withClient(FakeApi, (c) =>
      c.callTool({ name: "vacancy_get", arguments: { id: id(3) } }))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("vacancy not found")
  })

  test("an unreachable API is a clear tool error, not a crash", async () => {
    const url = "http://127.0.0.1:1/rpc"
    const result = await withClient(apiLayerFor(url), (c) =>
      Effect.gen(function*() {
        const first = yield* c.callTool({ name: "vacancies_top", arguments: {} })
        // the server must still answer afterwards
        const second = yield* c.callTool({ name: "system_health", arguments: {} })
        return { first, second }
      }))
    for (const r of [result.first, result.second]) {
      expect(r.isError).toBe(true)
      expect(JSON.stringify(r.content)).toContain(`otbor API is not reachable at ${url}; run \`otbor up\``)
    }
  })

  test("toolkit exposes handlers for every tool", () => {
    expect(Object.keys(OtborReadToolkit.tools).length).toBe(26)
    void OtborReadHandlers
  })
})
