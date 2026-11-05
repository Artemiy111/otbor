/**
 * The apply filter: the hard blocks of a decision come from a per
 * (hh account, resume) `PresetFilter`, evaluated by the same SQL as search.
 * Covers the fallback chain, a filter edit making decisions stale, the reason
 * naming the failed rules, and copying a preset.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { PresetFilter, VacancyId } from "@otbor/contract"
import { DEVOPS_APPLY_FILTER, DEVOPS_PRESET_TITLE } from "@otbor/domain"
import { Effect } from "effect"
import { ensureSystemPresets } from "../../src/services/bootstrap.ts"
import { PresetService } from "../../src/services/PresetService.ts"
import { ApplyFilterService, type ApplyFilterServiceShape } from "../../src/services/ApplyFilterService.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import { ResumeService } from "../../src/services/ResumeService.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("apply filter integration suite is opt-in", () => {
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

  const evaluate = (
    userId: string,
    input: { vacancyId: string; hhAccountId?: string; resumeId?: string; fit?: number }
  ) => support.evaluateVacancy(userId, { fit: 80, ...input })

  const sweep = (userId: string, ids: ReadonlyArray<string>) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* DecisionService
        return yield* service.evaluateBatch({ vacancyIds: ids as ReadonlyArray<VacancyId> })
      })
    )

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

  const devops_ = (label: string, salaryFrom = 400_000) =>
    support.seedVacancyTitled(label, `DevOps engineer ${label}`, {
      salaryFrom,
      workFormats: ["remote"],
      descriptionText: "Kubernetes Terraform Linux"
    })

  describe("apply filter", () => {
    test("without a row the built-in default applies; it judges the role, not salary or work format", async () => {
      const tenant = await support.seedTenant("af-default")
      const view = await support.applyFilterGet(tenant.userId, { hhAccountId: tenant.accountId })
      expect(view).toMatchObject({ source: "default", id: null, minFit: 45, tests: "human", freshHalfLifeHours: 72 })

      const good = await devops_("af-default-good")
      const cheap = await devops_("af-default-cheap", 100_000)
      const office = await support.seedVacancyTitled("af-default-office", "DevOps engineer office", {
        salaryFrom: 400_000,
        workFormats: ["office"]
      })
      const other = await support.seedVacancyTitled("af-default-other", "Frontend developer", {
        salaryFrom: 400_000,
        workFormats: ["remote"]
      })

      expect((await evaluate(tenant.userId, { vacancyId: good })).verdict).toBe("apply")
      // Salary and work format are personal: the template does not block on them.
      expect((await evaluate(tenant.userId, { vacancyId: cheap })).verdict).toBe("apply")
      expect((await evaluate(tenant.userId, { vacancyId: office })).verdict).toBe("apply")
      expect((await evaluate(tenant.userId, { vacancyId: other })).reasons[0]!.code).toBe("blocked_filter")
    })

    test("a skip names the failed rules", async () => {
      const tenant = await support.seedTenant("af-reasons")
      const sales = await support.seedVacancyTitled("af-reasons-1", "DevOps менеджер по продажам", {
        salaryFrom: 400_000,
        workFormats: ["remote"]
      })

      const decision = await evaluate(tenant.userId, { vacancyId: sales })
      expect(decision).toMatchObject({ verdict: "skip", fit: 0, priority: 0 })
      const reason = decision.reasons[0]!
      expect(reason.code).toBe("blocked_filter")
      expect(reason.detail).toContain("title not_contains продаж")
      // The passing rules are not listed.
      expect(reason.detail).not.toContain("title contains devops")
    })

    test("an exact (account, resume) row wins over the account row, which wins over the default", async () => {
      const tenant = await support.seedTenant("af-chain")
      const withRow = await createResume(tenant.userId, tenant.accountId, "af-chain-1")
      const noRow = await createResume(tenant.userId, tenant.accountId, "af-chain-2")

      // 1. nothing stored
      for (const resumeId of [undefined, withRow.id, noRow.id]) {
        const view = await support.applyFilterGet(tenant.userId, { hhAccountId: tenant.accountId, resumeId })
        expect(view.source).toBe("default")
      }

      // 2. an account row (resume null) answers for every resume
      const accountFilter: PresetFilter = { rules: [{ field: "salary", op: "gte", value: 500_000 }] }
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: accountFilter, minFit: 30 })
      const viaAccount = await support.applyFilterGet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId: noRow.id
      })
      expect(viaAccount).toMatchObject({ source: "account", resumeId: noRow.id, minFit: 30, filter: accountFilter })
      expect(
        (await support.applyFilterGet(tenant.userId, { hhAccountId: tenant.accountId })).source
      ).toBe("exact")

      // 3. an exact row beats it, for its resume only
      const exactFilter: PresetFilter = { rules: [{ field: "salary", op: "gte", value: 150_000 }] }
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId: withRow.id,
        filter: exactFilter
      })
      const exact = await support.applyFilterGet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId: withRow.id
      })
      expect(exact).toMatchObject({ source: "exact", filter: exactFilter, minFit: 45 })
      expect(
        (await support.applyFilterGet(tenant.userId, { hhAccountId: tenant.accountId, resumeId: noRow.id })).source
      ).toBe("account")

      // The decision follows the chain: 200k passes the exact row only.
      const vacancyId = await support.seedVacancyTitled("af-chain-v", "Backend developer", { salaryFrom: 200_000 })
      expect(
        (await evaluate(tenant.userId, { vacancyId, resumeId: withRow.id })).verdict
      ).toBe("apply")
      const viaAccountDecision = await evaluate(tenant.userId, { vacancyId, resumeId: noRow.id })
      expect(viaAccountDecision.reasons[0]).toMatchObject({ code: "blocked_filter", detail: "salary >= 500000" })
    })

    test("saving the same pair twice keeps one row and unspecified settings", async () => {
      const tenant = await support.seedTenant("af-upsert")
      const first = await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        filter: {},
        minFit: 20,
        tests: "allow"
      })
      const second = await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        filter: { includeArchived: true }
      })
      expect(second.id).toBe(first.id)
      expect(second).toMatchObject({ minFit: 20, tests: "allow", filter: { includeArchived: true } })
    })

    test("changing the filter makes decisions stale; a repeated save does not", async () => {
      const tenant = await support.seedTenant("af-stale")
      const v = await devops_("af-stale-v", 300_000)
      await support.openApplyFilter(tenant)

      expect((await sweep(tenant.userId, [v])).evaluated).toBe(1)
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(0)

      // The same filter again: nothing to redo.
      await support.openApplyFilter(tenant)
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(0)

      // A stricter filter re-decides, and the new decision is a skip.
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        filter: { rules: [{ field: "salary", op: "gte", value: 900_000 }] }
      })
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(1)
      const stricter = await evaluate(tenant.userId, { vacancyId: v })
      expect(stricter.reasons[0]).toMatchObject({ code: "blocked_filter", detail: "salary >= 900000" })
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(0)

      // Back to the open filter: decided again, applies again.
      await support.openApplyFilter(tenant)
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(1)
      expect((await evaluate(tenant.userId, { vacancyId: v })).verdict).toBe("apply")
      expect((await sweep(tenant.userId, [v])).evaluated).toBe(0)
    })

    test("settings change the outcome: min fit, and the filter hash covers them", async () => {
      const tenant = await support.seedTenant("af-settings")
      const v = await devops_("af-settings-v")
      await support.openApplyFilter(tenant)
      expect((await evaluate(tenant.userId, { vacancyId: v, fit: 50 })).verdict).toBe("apply")

      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, minFit: 70 })
      const low = await evaluate(tenant.userId, { vacancyId: v, fit: 50 })
      expect(low.reasons[0]).toMatchObject({ code: "blocked_low_fit", detail: "fit 50 < 70" })
    })

    test("archive comes from the filter", async () => {
      const tenant = await support.seedTenant("af-implicit")
      await support.openApplyFilter(tenant)
      const archived = await support.seedVacancyTitled("af-implicit-a", "DevOps archived", { archived: true })
      const decision = await evaluate(tenant.userId, { vacancyId: archived })
      expect(decision.reasons[0]).toMatchObject({ code: "blocked_filter", detail: "not archived" })
    })

    test("a filter can opt into blacklisted employers", async () => {
      const tenant = await support.seedTenant("af-blacklist")
      const suffix = Math.random().toString(36).slice(2, 8)
      const target = await support.seedVacancyForEmployer({
        label: `af-bl-${suffix}`,
        title: `DevOps engineer ${suffix}`,
        employerExternalId: `af-bl-emp-${suffix}`,
        employerName: `Blacklisted ${suffix}`
      })
      await support.blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `af-bl-emp-${suffix}`,
        name: `Blacklisted ${suffix}`
      })

      await support.openApplyFilter(tenant)
      expect((await evaluate(tenant.userId, { vacancyId: target.vacancyId })).reasons[0]).toMatchObject({
        code: "blocked_filter",
        detail: "not blacklisted"
      })

      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        filter: { includeBlacklisted: true }
      })
      expect((await evaluate(tenant.userId, { vacancyId: target.vacancyId })).verdict).toBe("apply")
    })

    test("a preset is copied into the filter and then independent of it", async () => {
      const tenant = await support.seedTenant("af-preset")
      const template: PresetFilter = { rules: [{ field: "title", op: "contains", value: "platform" }] }
      const presetId = await support.seedPreset(tenant.userId, { title: "Template" })
      await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const presets = yield* PresetService
          yield* presets.upsert({ id: presetId, kind: "apply", title: "Template", filter: template })
        })
      )

      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        filter: {},
        minFit: 33
      })
      const copied = await support.applyFilterFromPreset(tenant.userId, {
        hhAccountId: tenant.accountId,
        presetId
      })
      expect(copied).toMatchObject({ filter: template, minFit: 33, templatePresetId: presetId })

      // Editing the preset afterwards does not move the filter.
      await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const presets = yield* PresetService
          yield* presets.upsert({ id: presetId, kind: "apply", title: "Template", filter: {} })
        })
      )
      expect(
        (await support.applyFilterGet(tenant.userId, { hhAccountId: tenant.accountId })).filter
      ).toEqual(template)
    })

    test("unknown account, resume or preset are NotFound; bad settings are rejected", async () => {
      const tenant = await support.seedTenant("af-errors")
      const stranger = "01a1acd9-0000-7000-8000-000000000000"
      const fail = <A>(f: (filters: ApplyFilterServiceShape) => Effect.Effect<A, unknown>) =>
        support.runAsFailure(
          tenant.userId,
          Effect.gen(function*() {
            return yield* f(yield* ApplyFilterService)
          })
        )

      expect(await fail((f) => f.get({ hhAccountId: stranger }))).toMatchObject({ _tag: "NotFound" })
      expect(
        await fail((f) => f.get({ hhAccountId: tenant.accountId, resumeId: stranger }))
      ).toMatchObject({ _tag: "NotFound", entity: "Resume" })
      expect(
        await fail((f) => f.set({ hhAccountId: tenant.accountId, filter: {}, minFit: 101 }))
      ).toMatchObject({ _tag: "InvalidInput" })
      expect(
        await fail((f) => f.set({ hhAccountId: tenant.accountId, filter: {}, freshHalfLifeHours: 0 }))
      ).toMatchObject({ _tag: "InvalidInput" })
      expect(
        await fail((f) => f.fromPreset({ hhAccountId: tenant.accountId, presetId: stranger }))
      ).toMatchObject({ _tag: "NotFound", entity: "Preset" })
    })

    test("another user's filter never applies", async () => {
      const a = await support.seedTenant("af-rls-a")
      const b = await support.seedTenant("af-rls-b")
      await support.applyFilterSet(a.userId, {
        hhAccountId: a.accountId,
        filter: { rules: [{ field: "salary", op: "gte", value: 999_999_999 }] }
      })
      expect((await support.applyFilterGet(b.userId, { hhAccountId: b.accountId })).source).toBe("default")
      const stolen = await support.runAsFailure(
        b.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplyFilterService).get({ hhAccountId: a.accountId })
        })
      )
      expect(stolen).toMatchObject({ _tag: "NotFound" })
    })

    test("the DevOps system preset is seeded once and holds the default filter", async () => {
      const tenant = await support.seedTenant("af-system")
      const ensure = () =>
        support.runAs(
          "owner",
          Effect.gen(function*() {
            yield* ensureSystemPresets
          })
        )
      await ensure()
      await ensure()

      const presets = await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const service = yield* PresetService
          return yield* service.list({ kind: "apply" })
        })
      )
      const devops = presets.filter((preset) => preset.title === DEVOPS_PRESET_TITLE && preset.system)
      expect(devops).toHaveLength(1)
      expect(devops[0]!.filter).toEqual(DEVOPS_APPLY_FILTER)

      // Applying it to an account behaves like the default.
      const copied = await support.applyFilterFromPreset(tenant.userId, {
        hhAccountId: tenant.accountId,
        presetId: devops[0]!.id
      })
      expect(copied.templatePresetId).toBe(devops[0]!.id)
      const good = await devops_("af-system-good")
      expect((await evaluate(tenant.userId, { vacancyId: good })).verdict).toBe("apply")
    })
  })
}
