/** Integration: blacklist. See README.md for how to run. */
import type { VacancyDraft } from "@otbor/contract"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  addAccount,
  blacklistImportHh,
  blacklistList,
  blacklistUpsert,
  blacklistUpsertFailure,
  corpusIngest,
  corpusList,
  createTestDatabase,
  dropTestDatabase,
  employersList,
  evaluateVacancy,
  hiddenTargetRowsFor,
  integrationEnabled,
  migrateTestDatabase,
  presetPreview,
  seedTenant,
  seedApplication,
  seedResume,
  seedVacancyForEmployer,
  serverUrl,
  testDatabaseUrl
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    // Documented in test/integration/README.md and root `bun run test:integration`.
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    // `Database.layer` reads DATABASE_URL when the layer is built, so every
    // request in this suite points at the throwaway database.
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    await dropTestDatabase(base)
  }, 60_000)

  describe("blacklist", () => {
    const tag = () => randomUUID().slice(0, 8)

    test("an app block hides vacancies and companies by default, labels them when included", async () => {
      const tenant = await seedTenant("blacklist-app")
      const suffix = tag()

      const blocked = await seedVacancyForEmployer({
        label: `blocked-${suffix}`,
        title: `DevOps blocked ${suffix}`,
        employerExternalId: `bl-emp-${suffix}`,
        employerName: `Blocklist Co ${suffix}`
      })
      const specific = await seedVacancyForEmployer({
        label: `specific-${suffix}`,
        title: `DevOps specific ${suffix}`,
        employerExternalId: `visible-emp-${suffix}`,
        employerName: `Visible Co ${suffix}`
      })
      const visible = await seedVacancyForEmployer({
        label: `visible-${suffix}`,
        title: `DevOps visible ${suffix}`,
        employerExternalId: `other-emp-${suffix}`,
        employerName: `Other Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `bl-emp-${suffix}`,
        name: `Blocklist Co ${suffix}`,
        reason: "not interested"
      })
      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "vacancy",
        externalId: specific.externalId,
        name: `DevOps specific ${suffix}`
      })

      const hidden = await corpusList(tenant.userId, { limit: 200 })
      const hiddenIds = hidden.items.map((item) => String(item.id))
      expect(hiddenIds).not.toContain(blocked.vacancyId)
      expect(hiddenIds).not.toContain(specific.vacancyId)
      expect(hiddenIds).toContain(visible.vacancyId)

      const shown = await corpusList(tenant.userId, {
        includeBlacklisted: true,
        limit: 200
      })
      const blockedRow = shown.items.find((item) => item.id === blocked.vacancyId)!
      expect(blockedRow.blacklisted).toBe(true)
      expect(blockedRow.blacklistLayers).toEqual(["app"])
      const specificRow = shown.items.find((item) => item.id === specific.vacancyId)!
      expect(specificRow.blacklistLayers).toEqual(["app"])
      const visibleRow = shown.items.find((item) => item.id === visible.vacancyId)!
      expect(visibleRow.blacklisted).toBe(false)
      expect(visibleRow.blacklistLayers).toEqual([])

      // The companies page toggle: same filter, same label.
      const companiesHidden = await employersList(tenant.userId, {
        query: `Blocklist Co ${suffix}`,
        limit: 20
      })
      expect(companiesHidden.total).toBe(0)
      const companiesShown = await employersList(tenant.userId, {
        query: `Blocklist Co ${suffix}`,
        includeBlacklisted: true,
        limit: 20
      })
      expect(companiesShown.total).toBe(1)
      expect(companiesShown.items[0]!.blacklisted).toBe(true)
      expect(companiesShown.items[0]!.blacklistLayers).toEqual(["app"])

      // The row stayed in the corpus; only visibility changed.
      expect((await hiddenTargetRowsFor(tenant.userId)).length).toBe(2)

      // A filter hides nothing on its own: app-blocked rows leave only by a `hidden` rule.
      const previewFilter = {
        rules: [{ field: "title" as const, op: "contains" as const, value: suffix }]
      }
      expect((await presetPreview(tenant.userId, previewFilter)).count).toBe(3)
      const previewHidden = await presetPreview(tenant.userId, {
        rules: [...previewFilter.rules, { field: "hidden" as const, op: "not_in" as const, value: ["app"] }]
      })
      expect(previewHidden.count).toBe(1)
      expect(previewHidden.vacancies.map((item) => String(item.id))).toEqual([
        visible.vacancyId
      ])

      const previewShown = await presetPreview(tenant.userId, {
        rules: [...previewFilter.rules, { field: "hidden" as const, op: "not_in" as const, value: ["accounts"] }]
      })
      expect(previewShown.count).toBe(3)
      expect(previewShown.vacancies.find((item) => item.id === blocked.vacancyId)?.blacklisted)
        .toBe(true)
    })

    test("scope/account combinations are validated", async () => {
      const tenant = await seedTenant("blacklist-validate")

      const appWithAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "app",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(appWithAccount._tag).toBe("InvalidInput")

      const accountWithoutAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "hh_account",
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(accountWithoutAccount._tag).toBe("InvalidInput")

      const foreignAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "hh_account",
        hhAccountId: randomUUID(),
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(foreignAccount._tag).toBe("NotFound")
    })

    test("an account block applies only to that account", async () => {
      const tenant = await seedTenant("blacklist-account")
      const second = await addAccount(tenant.userId, "blacklist-account-second")
      const suffix = tag()

      const target = await seedVacancyForEmployer({
        label: `account-${suffix}`,
        title: `DevOps account ${suffix}`,
        employerExternalId: `account-emp-${suffix}`,
        employerName: `Account Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `account-emp-${suffix}`,
        name: `Account Co ${suffix}`
      })

      const first = await corpusList(tenant.userId, {
        hhAccountId: tenant.accountId,
        limit: 200
      })
      expect(first.items.map((item) => item.id)).not.toContain(target.vacancyId)

      const other = await corpusList(tenant.userId, {
        hhAccountId: second,
        limit: 200
      })
      expect(other.items.map((item) => String(item.id))).toContain(target.vacancyId)

      // Without an explicit account only the app layer applies.
      const noAccount = await corpusList(tenant.userId, { limit: 200 })
      expect(noAccount.items.map((item) => String(item.id))).toContain(target.vacancyId)

      const shown = await corpusList(tenant.userId, {
        hhAccountId: tenant.accountId,
        includeBlacklisted: true,
        limit: 200
      })
      const row = shown.items.find((item) => item.id === target.vacancyId)!
      expect(row.blacklisted).toBe(true)
      expect(row.blacklistLayers).toEqual(["hh_account"])

      const listing = await blacklistList(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId
      })
      expect(listing.total).toBe(1)
    })

    test("the hidden rule picks the layer and the account that hid a company", async () => {
      const tenant = await seedTenant("blacklist-hidden-rule")
      const second = await addAccount(tenant.userId, "blacklist-hidden-rule-second")
      const suffix = tag()
      const make = (name: string) =>
        seedVacancyForEmployer({
          label: `${name}-${suffix}`,
          title: `Hiddenrule ${name} ${suffix}`,
          employerExternalId: `hr-${name}-${suffix}`,
          employerName: `Hiddenrule ${name} Co ${suffix}`
        })
      const byApp = await make("app")
      const byList = await make("list")
      const byHh = await make("hh")
      const bySecond = await make("second")
      const clean = await make("clean")

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `hr-app-${suffix}`
      })
      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `hr-list-${suffix}`
      })
      await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [{ targetType: "employer", externalId: `hr-hh-${suffix}` }]
      })
      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: second,
        targetType: "employer",
        externalId: `hr-second-${suffix}`
      })

      const matching = async (op: "in" | "not_in", value: ReadonlyArray<string>) => {
        const preview = await presetPreview(tenant.userId, {
          rules: [
            { field: "title", op: "contains", value: `Hiddenrule` },
            { field: "title", op: "contains", value: suffix },
            { field: "hidden", op, value }
          ]
        })
        return preview.vacancies.map((item) => String(item.id)).sort()
      }
      const ids = (...rows: ReadonlyArray<{ readonly vacancyId: string }>) =>
        rows.map((row) => String(row.vacancyId)).sort()

      expect(await matching("in", ["app"])).toEqual(ids(byApp))
      expect(await matching("in", ["accounts"])).toEqual(ids(byList, byHh, bySecond))
      expect(await matching("in", ["hh"])).toEqual(ids(byHh))
      expect(await matching("in", [`account:${tenant.accountId}`])).toEqual(ids(byList, byHh))
      expect(await matching("in", [`hh:${second}`])).toEqual([])
      expect(await matching("in", ["any"])).toEqual(ids(byApp, byList, byHh, bySecond))
      expect(await matching("not_in", ["accounts"])).toEqual(ids(byApp, clean))
    })

    test("the applied rule hides companies by sent applications of any account or resume, ANDed", async () => {
      const tenant = await seedTenant("applied-rule")
      const second = await addAccount(tenant.userId, "applied-second")
      const suffix = tag()
      const resumeA = await seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "A" })
      const resumeB = await seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "B" })
      const resumeC = await seedResume({ userId: tenant.userId, accountId: second, title: "C" })

      const make = async (name: string) => {
        const row = await seedVacancyForEmployer({
          label: `${name}-${suffix}`,
          title: `Appliedrule ${name} ${suffix}`,
          employerExternalId: `ap-${name}-${suffix}`,
          employerName: `Applied ${name} ${suffix}`
        })
        // A second vacancy of the same company: the rule works per company.
        const sibling = await seedVacancyForEmployer({
          label: `${name}-sib-${suffix}`,
          title: `Appliedrule ${name} sibling ${suffix}`,
          employerExternalId: `ap-${name}-${suffix}`,
          employerName: `Applied ${name} ${suffix}`
        })
        return { ...row, siblingId: sibling.vacancyId }
      }
      const onlyA = await make("a")
      const aAndB = await make("ab")
      const onlyC = await make("c")
      const draftOnly = await make("draft")
      const clean = await make("clean")

      const apply = (vacancyId: string, accountId: string, resumeId: string, state: "submitted" | "draft" = "submitted") =>
        seedApplication({ userId: tenant.userId, accountId, vacancyId, resumeId, state })
      await apply(onlyA.vacancyId, tenant.accountId, resumeA)
      await apply(aAndB.vacancyId, tenant.accountId, resumeA)
      await apply(aAndB.siblingId, tenant.accountId, resumeB)
      await apply(onlyC.vacancyId, second, resumeC)
      await apply(draftOnly.vacancyId, tenant.accountId, resumeA, "draft")

      const matching = async (...rules: ReadonlyArray<{ op: "in" | "not_in"; value: ReadonlyArray<string> }>) => {
        const preview = await presetPreview(tenant.userId, {
          rules: [
            { field: "title", op: "contains", value: `Appliedrule` },
            { field: "title", op: "contains", value: suffix },
            ...rules.map((rule) => ({ field: "applied" as const, ...rule }))
          ]
        })
        return preview.vacancies.map((item) => String(item.id)).sort()
      }
      const ids = (...rows: ReadonlyArray<{ readonly vacancyId: string; readonly siblingId: string }>) =>
        rows.flatMap((row) => [row.vacancyId, row.siblingId]).map(String).sort()

      expect(await matching({ op: "in", value: ["any"] })).toEqual(ids(onlyA, aAndB, onlyC))
      expect(await matching({ op: "not_in", value: ["any"] })).toEqual(ids(draftOnly, clean))
      expect(await matching({ op: "not_in", value: [`account:${tenant.accountId}`] })).toEqual(ids(onlyC, draftOnly, clean))
      expect(await matching({ op: "in", value: [`account:${second}`] })).toEqual(ids(onlyC))
      expect(await matching({ op: "in", value: [`resume:${resumeA}`] })).toEqual(ids(onlyA, aAndB))
      // Applied with resume A but not with resume B.
      expect(
        await matching(
          { op: "in", value: [`resume:${resumeA}`] },
          { op: "not_in", value: [`resume:${resumeB}`] }
        )
      ).toEqual(ids(onlyA))
      // A stale selector matches nothing.
      expect(await matching({ op: "in", value: [`resume:${randomUUID()}`] })).toEqual([])
    })

    test("hh-native import is idempotent, updates names and never deletes absent entries", async () => {
      const tenant = await seedTenant("blacklist-native")
      const suffix = tag()
      const employerExternalId = `native-emp-${suffix}`
      const vacancyExternalId = `native-vac-${suffix}`

      const first = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [
          { targetType: "employer", externalId: employerExternalId, name: "Native Co" },
          { targetType: "vacancy", externalId: vacancyExternalId, name: "Native vacancy" }
        ]
      })
      expect(first).toEqual({ imported: 2, updated: 0, skipped: 0 })

      const rows = await hiddenTargetRowsFor(tenant.userId)
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.scope)).toEqual(["hh_native", "hh_native"])
      expect(rows.map((row) => row.source)).toEqual(["hh_hidden", "hh_hidden"])
      const firstSeen = rows.find((row) => row.externalId === employerExternalId)!.lastSeenAt!

      const second = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [
          {
            targetType: "employer",
            externalId: employerExternalId,
            name: "Native Co renamed"
          },
          { targetType: "vacancy", externalId: vacancyExternalId, name: "Native vacancy" }
        ]
      })
      expect(second).toEqual({ imported: 0, updated: 2, skipped: 0 })

      const afterSecond = await hiddenTargetRowsFor(tenant.userId)
      expect(afterSecond).toHaveLength(2)
      const renamed = afterSecond.find((row) => row.externalId === employerExternalId)!
      expect(renamed.name).toBe("Native Co renamed")
      expect(renamed.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(firstSeen.getTime())

      // Only the listed entry is touched; the other native row is not deleted.
      const third = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [{ targetType: "employer", externalId: employerExternalId }]
      })
      expect(third).toEqual({ imported: 0, updated: 1, skipped: 0 })
      expect(await hiddenTargetRowsFor(tenant.userId)).toHaveLength(2)
    })

    test("a company block marks a vacancy ingested later", async () => {
      const tenant = await seedTenant("blacklist-new")
      const suffix = tag()
      const employerExternalId = `new-emp-${suffix}`
      const externalId = `new-vac-${suffix}`

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: employerExternalId,
        name: `New Co ${suffix}`
      })

      const ingested = await corpusIngest(tenant.userId, [
        {
          externalId,
          canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
          title: `DevOps new ${suffix}`,
          employer: { externalId: employerExternalId, name: `New Co ${suffix}` },
          salary: { from: 300_000, to: 400_000, currency: "RUB" },
          workFormats: ["remote"],
          seniority: "senior"
        } satisfies VacancyDraft
      ])
      expect(ingested.inserted).toBe(1)
      const vacancyId = ingested.items[0]!.id

      const hidden = await corpusList(tenant.userId, { limit: 200 })
      expect(hidden.items.map((item) => item.id)).not.toContain(vacancyId)

      const shown = await corpusList(tenant.userId, {
        includeBlacklisted: true,
        limit: 200
      })
      const row = shown.items.find((item) => item.id === vacancyId)!
      expect(row.blacklisted).toBe(true)
      expect(row.blacklistLayers).toEqual(["app"])
    })

    test("evaluate blocks the app blacklist (through the filter) by default and proceeds when included", async () => {
      const tenant = await seedTenant("blacklist-evaluate")
      const suffix = tag()

      const target = await seedVacancyForEmployer({
        label: `evaluate-${suffix}`,
        title: `DevOps engineer ${suffix}`,
        employerExternalId: `evaluate-emp-${suffix}`,
        employerName: `Evaluate Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `evaluate-emp-${suffix}`,
        name: `Evaluate Co ${suffix}`
      })

      const blocked = await evaluateVacancy(tenant.userId, {
        vacancyId: target.vacancyId,
        fit: 80
      })
      expect(blocked.verdict).toBe("skip")
      expect(blocked.reasons[0]!.code).toBe("blocked_filter")
      expect(blocked.reasons[0]!.detail).toContain("hidden not_in")

      const included = await evaluateVacancy(tenant.userId, {
        vacancyId: target.vacancyId,
        fit: 80,
        includeBlacklisted: true
      })
      expect(included.verdict).not.toBe("skip")
      expect(included.reasons.map((reason) => reason.code)).not.toContain("blocked_filter")
    })

    test("RLS keeps one user's blacklist invisible to another", async () => {
      const a = await seedTenant("blacklist-rls-a")
      const b = await seedTenant("blacklist-rls-b")

      await blacklistUpsert(a.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `rls-emp-${tag()}`
      })

      // `BlacklistRepository.list` has no explicit user predicate; the empty
      // result for B is row-level security doing its job.
      expect((await blacklistList(b.userId)).items).toHaveLength(0)
      expect((await blacklistList(a.userId)).total).toBe(1)
    })
  })
}
