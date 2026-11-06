/**
 * Decision priority is live: `fit x freshness` evaluated at read time in SQL,
 * with the half-life of the decision's own apply filter. The stored
 * `decision.priority` is only a snapshot and never decides an order or a
 * `min_priority` threshold.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { APPLY_POLICY_VERSION, computeFreshness, DEFAULT_APPLY_SETTINGS } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as DecisionRepository from "../../src/repositories/DecisionRepository.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import { ResumeService } from "../../src/services/ResumeService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("live priority integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
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

  const owner = <A>(run: (tx: Parameters<Parameters<Database["Service"]["asOwner"]>[0]>[0]) => Effect.Effect<A, any>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) => run(tx))
      })
    ) as Promise<A>

  const exec = (query: ReturnType<typeof sql>) => owner((tx) => tx.execute(query))

  const createResume = (userId: string, hhAccountId: string, externalId: string) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const resumes = yield* ResumeService
        return yield* resumes.upsert({
          hhAccountId: hhAccountId as never,
          source: "hh",
          externalId,
          title: externalId,
          text: externalId,
          about: "",
          skills: [],
          experience: [],
          education: [],
          workFormats: [],
          isActive: true
        })
      })
    )

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

  /** A vacancy with an apply decision of fit 80, published `ageHours` ago. */
  const decided = async (
    tenant: support.Tenant,
    label: string,
    ageHours: number | null,
    resumeId?: string
  ) => {
    const vacancyId = await support.seedVacancyTitled(label, `DevOps engineer ${label}`, { salaryFrom: 300_000 })
    const decision = await support.evaluateVacancy(tenant.userId, {
      vacancyId,
      hhAccountId: tenant.accountId,
      fit: 80,
      ...(resumeId === undefined ? {} : { resumeId })
    })
    expect(decision.verdict).toBe("apply")
    await exec(
      sql`update vacancy set published_at = ${ageHours === null ? null : hoursAgo(ageHours)} where id = ${vacancyId}`
    )
    return { vacancyId, decisionId: decision.id }
  }

  const list = (tenant: support.Tenant, sort: "priority" | "fit" = "priority") =>
    support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        return yield* (yield* DecisionService).list({ verdict: "apply", sort, hhAccountId: tenant.accountId, limit: 50 })
      })
    )

  const candidates = (tenant: support.Tenant, minPriority: number, resumeId: string | null = null) =>
    support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asUser(tenant.userId, (tx) =>
          DecisionRepository.autoApplyCandidates(tx, tenant.userId, {
            hhAccountId: tenant.accountId,
            resumeId,
            excludeResumeIds: [],
            minPriority,
            sort: "priority",
            limit: 50,
            policyVersion: APPLY_POLICY_VERSION,
            analysisPromptVersion: "none"
          })
        )
      })
    )

  describe("live decision priority", () => {
    test("equal fit sorts by live freshness even when the stored priority is equal", async () => {
      const tenant = await support.seedTenant("lp-order")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {} })
      const old = await decided(tenant, "lp-old", 200)
      const fresh = await decided(tenant, "lp-fresh", 1)
      const mid = await decided(tenant, "lp-mid", 72)
      // The stored snapshot is identical (and wrong for all of them).
      await exec(sql`update decision set priority = 50 where id in (${old.decisionId}, ${fresh.decisionId}, ${mid.decisionId})`)

      const rows = await list(tenant)
      expect(rows.map((row) => row.id)).toEqual([fresh.decisionId, mid.decisionId, old.decisionId] as never)
      const byId = new Map(rows.map((row) => [row.id as string, row.priority]))
      expect(byId.get(fresh.decisionId)!).toBeCloseTo(80 * 0.5 ** (1 / 72), 1)
      expect(byId.get(mid.decisionId)!).toBeCloseTo(40, 1)
      expect(byId.get(old.decisionId)!).toBeLessThan(20)
    })

    test("a non-apply decision keeps its stored priority", async () => {
      const tenant = await support.seedTenant("lp-skip")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {} })
      const { decisionId } = await decided(tenant, "lp-skip", 5)
      await exec(sql`update decision set verdict = 'skip', priority = 0 where id = ${decisionId}`)
      const rows = await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* DecisionService).list({ verdict: "skip", hhAccountId: tenant.accountId })
        })
      )
      expect(rows.find((row) => row.id === decisionId)?.priority).toBe(0)
    })

    test("a per-pair half-life changes the order against the account half-life", async () => {
      const tenant = await support.seedTenant("lp-pair")
      const resumeA = (await createResume(tenant.userId, tenant.accountId, "lp-pair-resume")).id as string
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, freshHalfLifeHours: 72 })
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId: resumeA,
        filter: {},
        freshHalfLifeHours: 1000
      })
      // Same age (144h), same fit: the pair's 1000h half-life keeps it far fresher.
      const account = await decided(tenant, "lp-acct", 144)
      const pair = await decided(tenant, "lp-pair", 144, resumeA)
      await exec(sql`update decision set priority = 10 where id in (${account.decisionId}, ${pair.decisionId})`)

      const rows = await list(tenant)
      expect(rows.map((row) => row.id)).toEqual([pair.decisionId, account.decisionId] as never)
      const byId = new Map(rows.map((row) => [row.id as string, row.priority]))
      expect(byId.get(account.decisionId)!).toBeCloseTo(80 * 0.25, 1)
      expect(byId.get(pair.decisionId)!).toBeCloseTo(80 * 0.5 ** (144 / 1000), 1)

      // Without the pair row the account half-life applies to it too.
      await exec(sql`update apply_filter set fresh_half_life_hours = 72 where resume_id = ${resumeA}`)
      const after = await list(tenant)
      expect(after.find((row) => row.id === pair.decisionId)!.priority).toBeCloseTo(20, 1)
    })

    test("min_priority in the candidate selection uses live priority", async () => {
      const tenant = await support.seedTenant("lp-min")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {} })
      const fresh = await decided(tenant, "lp-min-fresh", 1)
      const old = await decided(tenant, "lp-min-old", 400)
      // Stored priority says both clear the bar; the live value does not.
      await exec(sql`update decision set priority = 80 where id in (${fresh.decisionId}, ${old.decisionId})`)

      const picked = await candidates(tenant, 40)
      expect(picked.map((row) => row.id)).toEqual([fresh.decisionId] as never)
      expect((await candidates(tenant, 0)).length).toBe(2)
    })

    test("the SQL formula agrees with computeFreshness", async () => {
      const tenant = await support.seedTenant("lp-formula")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, freshHalfLifeHours: 48 })
      const ages = [0, 1, 12, 48, 100, 500, 5000]
      const made = []
      for (const age of ages) made.push({ age, ...(await decided(tenant, `lp-f-${age}`, age)) })
      const undated = await decided(tenant, "lp-f-null", null)

      const rows = await list(tenant)
      const now = new Date()
      for (const item of made) {
        const row = rows.find((candidate) => candidate.id === item.decisionId)!
        const expected = 80 * computeFreshness(hoursAgo(item.age), now, 48).freshness
        expect(Math.abs(row.priority - expected)).toBeLessThan(0.01)
      }
      expect(rows.find((row) => row.id === undated.decisionId)!.priority).toBe(40)
      expect(DEFAULT_APPLY_SETTINGS.freshHalfLifeHours).toBe(72)
    })
  })
}
