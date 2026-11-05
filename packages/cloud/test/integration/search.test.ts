import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { PresetFilter } from "@otbor/contract"
import { Effect } from "effect"
import { CorpusService } from "../../src/services/CorpusService.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("vacancy search integration suite is opt-in", () => {
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

  const search = (userId: string, options: Record<string, unknown>) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* DecisionService
        return yield* service.list({ latestPerVacancy: true, limit: 50, ...options })
      })
    )

  describe("ad-hoc vacancy search (DecisionService.list)", () => {
    test("combines seniority, skills, company-size proxies, preset, fit bounds and sort", async () => {
      const tenant = await support.seedTenant("search")
      // These vacancies are not all DevOps by title; the filter is not under test here.
      await support.openApplyFilter(tenant)

      const small = await support.seedEmployerStats("e-small", "Small Co", { rating: 4.2, reviewsCount: 12 })
      const big = await support.seedEmployerStats("e-big", "Big Corp", { rating: 3.9, reviewsCount: 5000 })
      const unrated = await support.seedEmployerStats("e-none", "Unrated Co")

      // Big Corp has four open vacancies and one archived (does not count); Small Co has three.
      const bigMiddle = await support.seedSearchVacancy({
        label: "big1", title: "Platform Engineer", employerId: big, seniority: "middle",
        skills: ["Kubernetes"], salaryFrom: 300_000, salaryCurrency: "RUR", publishedDaysAgo: 2
      })
      const bigSenior = await support.seedSearchVacancy({
        label: "big2", title: "SRE", employerId: big, seniority: "senior"
      })
      await support.seedSearchVacancy({ label: "big3", title: "Old", employerId: big, archived: true })
      await support.seedSearchVacancy({ label: "big4", title: "Open A", employerId: big })
      await support.seedSearchVacancy({ label: "big5", title: "Open B", employerId: big })

      const smallMiddle = await support.seedSearchVacancy({
        label: "small1", title: "DevOps Engineer", employerId: small, seniority: "middle",
        experienceCode: "between3And6", skills: ["Kubernetes", "Terraform"],
        salaryFrom: 200_000, salaryCurrency: "RUR", publishedDaysAgo: 10
      })
      const smallUnknown = await support.seedSearchVacancy({
        label: "small2", title: "Infra Engineer", employerId: small, seniority: "unknown",
        skills: ["kubernetes"], salaryFrom: 400_000, salaryCurrency: "RUR", publishedDaysAgo: 1
      })
      const smallSenior = await support.seedSearchVacancy({
        label: "small3", title: "Lead DevOps", employerId: small, seniority: "senior", skills: ["Kubernetes"]
      })
      const unratedMiddle = await support.seedSearchVacancy({
        label: "unrated1", title: "Support", employerId: unrated, seniority: "middle"
      })

      const fits: Record<string, number> = {
        [bigMiddle]: 80, [bigSenior]: 20, [smallMiddle]: 55, [smallUnknown]: 65, [smallSenior]: 50,
        [unratedMiddle]: 30
      }
      for (const [vacancyId, fit] of Object.entries(fits)) {
        await support.evaluateVacancy(tenant.userId, { vacancyId, fit })
      }

      // The test policy may give any verdict; filter on the unconstrained list.
      const ids = async (options: Record<string, unknown>) =>
        (await search(tenant.userId, options)).map((row): string => row.vacancyId)

      const rules: NonNullable<PresetFilter["rules"]> = [
        { field: "seniority", op: "in", value: ["middle", "unknown"] },
        { field: "skills", op: "contains", value: "kubernetes" }
      ]

      // "around middle, Kubernetes, not a big company"
      expect(await ids({
        filter: { rules: [...rules, { field: "employer_vacancies", op: "lte", value: 3 }] },
        sort: "fit"
      })).toEqual([smallUnknown, smallMiddle])

      // Without the size rule the big employer returns.
      expect(await ids({ filter: { rules }, sort: "fit" })).toEqual([bigMiddle, smallUnknown, smallMiddle])

      // The archived vacancy does not count towards employer_vacancies: Big Corp has 4.
      expect(await ids({
        filter: { rules: [{ field: "employer_vacancies", op: "eq", value: 4 }] },
        sort: "fit"
      })).toEqual([bigMiddle, bigSenior])

      // Reviews and rating: employers without them are not matched.
      expect(await ids({ filter: { rules: [{ field: "employer_reviews", op: "lte", value: 100 }] }, sort: "fit" }))
        .toEqual([smallUnknown, smallMiddle, smallSenior])
      expect(await ids({ filter: { rules: [{ field: "employer_rating", op: "gte", value: 4 }] }, sort: "fit" }))
        .toEqual([smallUnknown, smallMiddle, smallSenior])

      // experience, published_days and salary sort
      expect(await ids({ filter: { rules: [{ field: "experience", op: "in", value: ["between3And6"] }] } }))
        .toEqual([smallMiddle])
      expect(await ids({ filter: { rules: [{ field: "published_days", op: "lte", value: 3 }] }, sort: "newest" }))
        .toEqual([smallUnknown, bigMiddle])
      expect(await ids({ filter: { rules: [{ field: "salary_from", op: "gte", value: 1 }] }, sort: "salary" }))
        .toEqual([smallUnknown, bigMiddle, smallMiddle])

      // fit bounds ("mediocre")
      expect(await ids({ minFit: 45, maxFit: 65, sort: "fit" })).toEqual([smallUnknown, smallMiddle, smallSenior])

      // preset AND ad-hoc filter
      const preset = await support.seedPreset(tenant.userId, { title: "devops", filter: { text: "devops" } })
      expect((await ids({ presetId: preset })).sort()).toEqual([smallMiddle, smallSenior].sort())
      expect(await ids({
        presetId: preset,
        filter: { rules: [{ field: "seniority", op: "eq", value: "middle" }] }
      })).toEqual([smallMiddle])

      // random sort and offset return a valid page
      expect(await ids({ sort: "random", limit: 2 })).toHaveLength(2)
      expect(await ids({ sort: "fit", limit: 2, offset: 1 })).toEqual([smallUnknown, smallMiddle])
    }, 60_000)
  })

  describe("vacancy list with ad-hoc rules (CorpusService.list)", () => {
    test("applies the same rule builder as presets and keeps archive control in the filter", async () => {
      const tenant = await support.seedTenant("list-filter")
      const employer = await support.seedEmployerStats("e-list", "List Co")
      const middle = await support.seedSearchVacancy({
        label: "lf1", title: "Mid", employerId: employer, seniority: "middle", skills: ["Kubernetes"]
      })
      await support.seedSearchVacancy({ label: "lf2", title: "Sen", employerId: employer, seniority: "senior" })
      const archived = await support.seedSearchVacancy({
        label: "lf3", title: "Old mid", employerId: employer, seniority: "middle", archived: true
      })

      const ids = async (filter: PresetFilter | undefined) =>
        (await support.runAs(
          tenant.userId,
          Effect.gen(function*() {
            const corpus = yield* CorpusService
            return yield* corpus.list({ limit: 50, filter })
          })
        )).items.map((row): string => row.id)

      expect(await ids({ rules: [{ field: "seniority", op: "eq", value: "middle" }] })).toEqual([middle])
      expect((await ids({
        rules: [{ field: "seniority", op: "eq", value: "middle" }],
        includeArchived: true
      })).sort()).toEqual([middle, archived].sort())
      expect(await ids({ rules: [{ field: "skills", op: "contains", value: "kubernetes" }] })).toEqual([middle])
      expect((await ids(undefined)).length).toBe(2)
    }, 60_000)
  })

    test("salary compares the vacancy range, pins a currency, accepts missing salaries and ORs currencies", async () => {
      const tenant = await support.seedTenant("salary-filter")
      const employer = await support.seedEmployerStats("e-salary", "Salary Co")
      const mk = (label: string, extra: { salaryFrom?: number; salaryTo?: number; salaryCurrency?: string }) =>
        support.seedSearchVacancy({ label, title: label, employerId: employer, ...extra })

      const rub150300 = await mk("s1", { salaryFrom: 150_000, salaryTo: 300_000, salaryCurrency: "RUR" })
      const rub400 = await mk("s2", { salaryFrom: 400_000, salaryCurrency: "RUR" })
      const usd4k = await mk("s3", { salaryFrom: 4_000, salaryTo: 5_000, salaryCurrency: "USD" })
      const none = await mk("s4", {})

      const ids = async (filter: PresetFilter) =>
        (await support.runAs(
          tenant.userId,
          Effect.gen(function*() {
            const corpus = yield* CorpusService
            return yield* corpus.list({ limit: 50, filter })
          })
        )).items.map((row): string => row.id).sort()
      const sorted = (...list: Array<string>) => [...list].sort()

      // range: >= 200k and <= 350k in rubles overlaps the first vacancy only
      expect(await ids({ rules: [
        { field: "salary", op: "gte", value: 200_000, currency: "RUR" },
        { field: "salary", op: "lte", value: 350_000, currency: "RUR" }
      ] })).toEqual([rub150300])

      // "= 250k" means the number lies inside the vacancy range
      expect(await ids({ rules: [{ field: "salary", op: "eq", value: 250_000 }] })).toEqual([rub150300])

      // a currency pin excludes the other currency; without a pin only the number counts
      expect(await ids({ rules: [{ field: "salary", op: "gt", value: 3_000, currency: "USD" }] })).toEqual([usd4k])

      // vacancies without a salary pass only with orMissing
      expect(await ids({ rules: [{ field: "salary", op: "gte", value: 350_000, currency: "RUR", orMissing: true }] }))
        .toEqual(sorted(rub400, none))

      // OR across currencies: 350k+ rubles, or 3k+ dollars
      expect(await ids({ groups: [{ branches: [
        { rules: [{ field: "salary", op: "gte", value: 350_000, currency: "RUR" }] },
        { rules: [{ field: "salary", op: "gte", value: 3_000, currency: "USD" }] }
      ] }] })).toEqual(sorted(rub400, usd4k))
    }, 60_000)
    test("location matches a country with all its cities, a single city, several places and negation", async () => {
      const tenant = await support.seedTenant("location-filter")
      const employer = await support.seedEmployerStats("e-location", "Location Co")
      const mk = (label: string, areaId?: number) =>
        support.seedSearchVacancy({ label, title: label, employerId: employer, ...(areaId === undefined ? {} : { areaId }) })

      // hh ids: 1 Москва, 2 Санкт-Петербург (Россия 113); 160 Алматы (Казахстан 40); 1002 Минск (Беларусь 16)
      const moscow = await mk("l1", 1)
      const spb = await mk("l2", 2)
      const almaty = await mk("l3", 160)
      const minsk = await mk("l4", 1002)
      const unknown = await mk("l5")

      const ids = async (filter: PresetFilter) =>
        (await support.runAs(
          tenant.userId,
          Effect.gen(function*() {
            const corpus = yield* CorpusService
            return yield* corpus.list({ limit: 50, filter })
          })
        )).items.map((row): string => row.id).sort()
      const sorted = (...list: Array<string>) => [...list].sort()

      expect(await ids({ rules: [{ field: "location", op: "in", value: ["113"] }] })).toEqual(sorted(moscow, spb))
      expect(await ids({ rules: [{ field: "location", op: "in", value: ["2"] }] })).toEqual([spb])
      expect(await ids({ rules: [{ field: "location", op: "in", value: ["40", "16"] }] })).toEqual(sorted(almaty, minsk))
      expect(await ids({ rules: [{ field: "location", op: "in", value: ["113", "160"] }] }))
        .toEqual(sorted(moscow, spb, almaty))
      expect(await ids({ rules: [{ field: "location", op: "not_in", value: ["113"] }] }))
        .toEqual(sorted(almaty, minsk, unknown))
    }, 60_000)
}
