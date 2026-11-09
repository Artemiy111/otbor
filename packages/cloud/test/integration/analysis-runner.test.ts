/**
 * The analysis pass against a real Postgres with a fake SystemOne client:
 * analysis, skip when the input hash matches, stale re-analysis, and stopping
 * the whole pass when the server is down.
 */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { ANALYSIS_PROMPT_VERSION, buildAnalysisState } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as VacancyAnalysisRepository from "../../src/repositories/VacancyAnalysisRepository.ts"
import { AnalysisRunner, analysisInputHash } from "../../src/services/AnalysisRunner.ts"
import { SystemOneClient, SystemOneError } from "../../src/services/SystemOneClient.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("analysis runner integration suite is opt-in", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await support.createTestDatabase(base)
    await support.migrateTestDatabase(base)
    process.env.DATABASE_URL = support.testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await support.dropTestDatabase(base)
  }, 60_000)

  let calls: Array<string> = []
  let mode: "ok" | "down" | "unauthorized" | "bad_for_first" = "ok"

  const fake = Layer.succeed(
    SystemOneClient,
    SystemOneClient.of({
      model: "fake-model",
      endpoint: "http://fake",
      ping: () => Effect.succeed({ reachable: true, latencyMs: 1, error: null }),
      analyze: (state) => {
        calls.push(state.title)
        if (mode === "down") {
          return Effect.fail(new SystemOneError({ kind: "unreachable", message: "SystemOne недоступен" }))
        }
        if (mode === "unauthorized") {
          return Effect.fail(new SystemOneError({ kind: "unauthorized", message: "ключ отклонён" }))
        }
        if (mode === "bad_for_first" && calls.length === 1) {
          return Effect.fail(new SystemOneError({ kind: "bad_response", message: "не JSON" }))
        }
        return Effect.succeed({
          answers: {
            is_it: { type: "noul" as const, noul: 0.99 },
            role: { type: "choice" as const, choice: "devops", confidence: 0.95 }
          },
          latencyMs: 12,
          tokens: null
        })
      }
    })
  )

  const options = { systemOne: fake }
  const run = (limit = 50) =>
    support.runAsWithOptions(
      "owner",
      options,
      Effect.gen(function*() {
        const runner = yield* AnalysisRunner
        return yield* runner.run({ limit })
      })
    )

  const owner = <A, E>(
    f: (tx: Parameters<Parameters<Database["Service"]["asOwner"]>[0]>[0]) => Effect.Effect<A, E, never>
  ) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner(f)
      })
    )

  const reset = () => owner((tx) => tx.execute(sql`delete from vacancy_analysis`))
  const stored = (vacancyId: string) =>
    owner((tx) => VacancyAnalysisRepository.get(tx, vacancyId, ANALYSIS_PROMPT_VERSION))

  const seed = async (label: string) =>
    support.seedVacancyForEmployer({
      label: `runner-${label}`,
      title: `Title ${label}`,
      employerExternalId: `emp-${label}-${Math.random().toString(36).slice(2, 8)}`,
      employerName: `Co ${label}`
    })

  test("analyses candidates, then skips and freshens them when the input hash is unchanged", async () => {
    const one = await seed("one")
    await reset()
    mode = "ok"
    calls = []

    const first = await run()
    expect(first.stoppedBy).toBeNull()
    expect(first.analysed).toBeGreaterThanOrEqual(1)
    expect(first.failed).toBe(0)
    const row = await stored(one.vacancyId)
    expect(row?.model).toBe("fake-model")
    expect(row?.facts.role?.value).toBe("devops")
    expect(row?.latencyMs).toBe(12)

    // Make it a candidate again without changing its input: the vacancy row is touched.
    await owner((tx) => tx.execute(sql`update vacancy set updated_at = now() + interval '1 minute' where id = ${one.vacancyId}`))
    calls = []
    const second = await run()
    expect(second.skipped).toBeGreaterThanOrEqual(1)
    expect(calls).not.toContain(`Title one`)
    const after = await stored(one.vacancyId)
    expect(after?.inputHash).toBe(row?.inputHash)
    expect(after!.updatedAt.getTime()).toBeGreaterThan(row!.updatedAt.getTime())
  })

  test("a changed input is re-analysed and the hash follows the sent state", async () => {
    const two = await seed("two")
    await reset()
    mode = "ok"
    calls = []
    await run()
    const before = await stored(two.vacancyId)

    await owner((tx) =>
      tx.execute(sql`update employer set description_text = 'Совсем другой текст' where id = ${two.employerId}`)
    )
    calls = []
    const result = await run()
    expect(calls).toContain("Title two")
    expect(result.analysed).toBeGreaterThanOrEqual(1)
    const after = await stored(two.vacancyId)
    expect(after?.inputHash).not.toBe(before?.inputHash)

    const otherRows = await owner((tx) =>
      VacancyAnalysisRepository.listCandidates(tx, { promptVersion: "other", limit: 500 })
    )
    const [candidate] = otherRows.filter((item) => item.vacancyId === two.vacancyId)
    expect(after?.inputHash).toBe(analysisInputHash(buildAnalysisState(candidate!.input)))
  })

  test("an unreachable or unauthorized server stops the pass without failing every vacancy", async () => {
    await seed("down-a")
    await seed("down-b")
    await seed("down-c")
    await reset()

    for (const kind of ["down", "unauthorized"] as const) {
      mode = kind
      calls = []
      const result = await run()
      expect(calls).toHaveLength(1)
      expect(result.stoppedBy).toBe(kind === "down" ? "unreachable" : "unauthorized")
      expect(result.analysed).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(1)
    }
  })

  test("a bad response fails one vacancy and the pass continues; limit bounds model calls", async () => {
    await seed("bad-a")
    await seed("bad-b")
    await reset()
    mode = "bad_for_first"
    calls = []
    const result = await run()
    expect(result.stoppedBy).toBeNull()
    expect(result.failed).toBe(1)
    expect(result.analysed).toBeGreaterThanOrEqual(1)

    await reset()
    mode = "ok"
    calls = []
    const bounded = await run(1)
    expect(bounded.analysed).toBe(1)
    expect(calls).toHaveLength(1)
  })
}
