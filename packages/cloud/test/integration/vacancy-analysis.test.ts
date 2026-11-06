/**
 * Vacancy analysis storage against a real Postgres: one row per (vacancy,
 * prompt version), a shared read policy, owner-only writes, and a candidate
 * query that finds never-analysed and possibly stale vacancies.
 */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { interpretAnswers } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as VacancyAnalysisRepository from "../../src/repositories/VacancyAnalysisRepository.ts"
import { VacancyAnalysisService } from "../../src/services/VacancyAnalysisService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("vacancy analysis integration suite is opt-in", () => {
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

  const candidates = async (vacancyId: string, promptVersion = "a4") => {
    const rows = await owner((tx) => VacancyAnalysisRepository.listCandidates(tx, { promptVersion, limit: 500 }))
    return rows.filter((row) => row.vacancyId === vacancyId)
  }

  const facts = interpretAnswers({ overtime: { type: "noul", noul: 0.02 } }, { threshold: 0.8 })

  const record = (vacancyId: string, inputHash: string, promptVersion = "a4") => ({
    vacancyId,
    promptVersion,
    inputHash,
    model: "clef-flash-4bit",
    answers: { overtime: { type: "noul", noul: 0.02 } },
    facts,
    threshold: 0.8,
    latencyMs: 4200
  })

  test("upsert is one row per (vacancy, prompt version); get returns it to any user", async () => {
    const seeded = await support.seedVacancyForEmployer({
      label: "analysis",
      title: "DevOps",
      employerExternalId: `emp-${Math.random().toString(36).slice(2, 8)}`,
      employerName: "Acme"
    })

    const first = await owner((tx) => VacancyAnalysisRepository.upsert(tx, record(seeded.vacancyId, "h1")))
    expect(first.inputHash).toBe("h1")
    const second = await owner((tx) => VacancyAnalysisRepository.upsert(tx, record(seeded.vacancyId, "h2")))
    expect(second.inputHash).toBe("h2")
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime())
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
    await owner((tx) => VacancyAnalysisRepository.upsert(tx, record(seeded.vacancyId, "other", "a5")))

    const rows = await owner((tx) =>
      tx.execute(sql`select count(*)::int as n from vacancy_analysis where vacancy_id = ${seeded.vacancyId}`)
    )
    expect((rows.rows[0] as { n: number }).n).toBe(2)

    const tenant = await support.seedTenant("analysis-reader")
    const read = await support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const service = yield* VacancyAnalysisService
        return yield* service.get(seeded.vacancyId as never)
      })
    )
    expect(read?.inputHash).toBe("h2")
    expect(read?.promptVersion).toBe("a4")
    expect(read?.facts.overtime).toEqual({ value: false, confidence: 0.98 })
    expect(read?.latencyMs).toBe(4200)
  })

  test("a vacancy without analysis reads as null", async () => {
    const seeded = await support.seedVacancy("analysis-none")
    const tenant = await support.seedTenant("analysis-none-reader")
    const read = await support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const service = yield* VacancyAnalysisService
        return yield* service.get(seeded as never)
      })
    )
    expect(read).toBeNull()
  })

  test("the runtime role can read but not write the table", async () => {
    const seeded = await support.seedVacancy("analysis-rls")
    const tenant = await support.seedTenant("analysis-rls-user")
    const attempt = support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asUser(tenant.userId, (tx) =>
          VacancyAnalysisRepository.upsert(tx, record(seeded, "nope"))
        )
      })
    )
    await expect(attempt).rejects.toThrow()
  })

  test("candidates: never-analysed first, fresh ones drop out, employer changes bring them back", async () => {
    const seeded = await support.seedVacancyForEmployer({
      label: "analysis-cand",
      title: "SRE",
      employerExternalId: `emp-${Math.random().toString(36).slice(2, 8)}`,
      employerName: "Beta"
    })

    const before = await candidates(seeded.vacancyId)
    expect(before).toHaveLength(1)
    expect(before[0]!.current).toBeNull()
    expect(before[0]!.input.title).toBe("SRE")
    expect(before[0]!.input.employer?.name).toBe("Beta")

    await owner((tx) => VacancyAnalysisRepository.upsert(tx, record(seeded.vacancyId, "x")))
    expect(await candidates(seeded.vacancyId)).toHaveLength(0)
    // another prompt version has not analysed it yet
    expect(await candidates(seeded.vacancyId, "a5")).toHaveLength(1)

    await owner((tx) =>
      tx.execute(sql`update employer set description_text = 'Новый текст о компании', category = 'agency' where id = ${seeded.employerId}`)
    )
    const stale = await candidates(seeded.vacancyId)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.current?.inputHash).toBe("x")
    expect(stale[0]!.employerCategory).toBe("agency")
    expect(stale[0]!.input.employer?.descriptionText).toBe("Новый текст о компании")

    await owner((tx) => VacancyAnalysisRepository.markFresh(tx, seeded.vacancyId, "a4"))
    expect(await candidates(seeded.vacancyId)).toHaveLength(0)
  })

  test("only fully hydrated vacancies are candidates and counts follow", async () => {
    const seeded = await support.seedVacancyForEmployer({
      label: "analysis-stub",
      title: "Stub",
      employerExternalId: `emp-${Math.random().toString(36).slice(2, 8)}`,
      employerName: "Gamma"
    })
    await owner((tx) => tx.execute(sql`update vacancy set hydration_status = 'stub' where id = ${seeded.vacancyId}`))
    expect(await candidates(seeded.vacancyId)).toHaveLength(0)
    await owner((tx) => tx.execute(sql`update vacancy set hydration_status = 'full' where id = ${seeded.vacancyId}`))
    expect(await candidates(seeded.vacancyId)).toHaveLength(1)

    const counts = await owner((tx) => VacancyAnalysisRepository.counts(tx, "a4"))
    expect(counts.total).toBeGreaterThanOrEqual(counts.analysed)
    expect(counts.analysed).toBeGreaterThanOrEqual(1)
  })
}
