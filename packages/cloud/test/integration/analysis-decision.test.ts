/**
 * The decision cascade with a stored vacancy analysis: a confident devops
 * analysis promotes an `unknown` title to a match, a title reject stays final,
 * a changed analysis makes the decision stale, and one query serves a batch.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VacancyId } from "@otbor/contract"
import { interpretAnswers } from "@otbor/domain"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as VacancyAnalysisRepository from "../../src/repositories/VacancyAnalysisRepository.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("analysis decision integration suite is opt-in", () => {
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

  const answers = {
    is_it_role: { type: "noul", noul: 0.98 },
    role: { type: "choice", choice: "devops", confidence: 0.97, probabilities: { devops: 0.97 } },
    required_level: { type: "choice", choice: "senior", confidence: 0.9, probabilities: { senior: 0.9 } },
    test_task: { type: "choice", choice: "none", confidence: 0.95, probabilities: { none: 0.95 } }
  } as const

  const store = (vacancyId: string, raw: Record<string, unknown>, inputHash = "h1") =>
    owner((tx) =>
      VacancyAnalysisRepository.upsert(tx, {
        vacancyId,
        promptVersion: "a4",
        inputHash,
        model: "clef-flash-4bit",
        answers: raw,
        facts: interpretAnswers(raw as never, { threshold: 0.8 }),
        threshold: 0.8,
        latencyMs: 1000
      })
    )

  const batch = (userId: string, ids: ReadonlyArray<string>) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* DecisionService
        return yield* service.evaluateBatch({ vacancyIds: ids as ReadonlyArray<VacancyId> })
      })
    )

  const latest = async (userId: string, vacancyId: string) =>
    (
      await support.runAs(
        userId,
        Effect.gen(function*() {
          const service = yield* DecisionService
          return yield* service.list({ latestPerVacancy: true, limit: 200 })
        })
      )
    ).find((row) => row.vacancyId === vacancyId)

  const seed = (label: string, title: string) =>
    support.seedVacancyTitled(label, title, {
      salaryFrom: 400_000,
      workFormats: ["remote"],
      descriptionText: "Kubernetes Terraform Linux. Ansible."
    })

  describe("analysis in the decision cascade", () => {
    test("an unknown title becomes apply once a confident devops analysis exists, and the decision goes stale", async () => {
      const tenant = await support.seedTenant("analysis-gate")
      const id = await seed("an-gate", "Инженер по автоматизации инфраструктуры")

      expect((await batch(tenant.userId, [id])).evaluated).toBe(1)
      const before = await latest(tenant.userId, id)
      expect(before?.verdict).toBe("skip")
      expect(before?.gate).toBe("unknown")
      // Nothing changed: not stale.
      expect((await batch(tenant.userId, [id])).evaluated).toBe(0)

      await store(id, answers)
      expect((await batch(tenant.userId, [id])).evaluated).toBe(1)
      const after = await latest(tenant.userId, id)
      expect(after?.verdict).toBe("apply")
      expect(after?.gate).toBe("match")
      expect(after?.reasons.find((reason) => reason.code === "role_match")?.detail).toBe(
        "analysis (devops 0.97)"
      )
      expect(after?.reasons.find((reason) => reason.code === "seniority")?.detail).toBe(
        "analysis: senior -> senior (0.90)"
      )

      // Settled: the same analysis does not re-run the evaluation on every pass.
      expect((await batch(tenant.userId, [id])).evaluated).toBe(0)

      // A changed analysis (no longer a devops role) re-decides it.
      await store(id, { ...answers, role: { type: "choice", choice: "backend", confidence: 0.95 } }, "h2")
      expect((await batch(tenant.userId, [id])).evaluated).toBe(1)
      expect((await latest(tenant.userId, id))?.verdict).toBe("skip")
    })

    test("a title reject is final even with a confident analysis", async () => {
      const tenant = await support.seedTenant("analysis-reject")
      const id = await seed("an-reject", "Менеджер по продажам DevOps-услуг")
      await store(id, answers)
      await batch(tenant.userId, [id])
      const decision = await latest(tenant.userId, id)
      expect(decision?.verdict).toBe("skip")
      expect(decision?.gate).toBe("reject")
    })

    test("a confident unpaid test task in the analysis blocks the vacancy", async () => {
      const tenant = await support.seedTenant("analysis-test")
      const id = await seed("an-test", "DevOps engineer")
      await store(id, { ...answers, test_task: { type: "choice", choice: "unpaid", confidence: 0.95 } })
      await batch(tenant.userId, [id])
      const decision = await latest(tenant.userId, id)
      expect(decision?.verdict).toBe("skip")
      expect(decision?.reasons[0]?.code).toBe("blocked_test")
    })
  })
}
