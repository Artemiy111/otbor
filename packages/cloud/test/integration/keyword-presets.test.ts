/** Integration: keyword-presets. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  createTestDatabase,
  dropTestDatabase,
  findPreset,
  integrationEnabled,
  lexiconList,
  lexiconListFailure,
  migrateTestDatabase,
  presetPreview,
  removePreset,
  seedKeyword,
  seedKeywordAlias,
  seedPreset,
  seedTenant,
  seedVacancyKeyword,
  seedVacancySkill,
  seedVacancyTitled,
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

  describe("keyword presets", () => {
    test("two presets select different keyword sets and counts", async () => {
      const tenant = await seedTenant("keyword-presets")
      // Random suffixes keep the shared keyword table independent of other runs.
      const suffix = randomUUID().slice(0, 8)
      const docker = await seedKeyword(`docker-${suffix}`)
      const kubernetes = await seedKeyword(`kubernetes-${suffix}`)
      const typescript = await seedKeyword(`typescript-${suffix}`)

      const devops = await seedVacancyTitled("devops", "DevOps Kubernetes engineer")
      const devopsPlatform = await seedVacancyTitled(
        "devops-platform",
        "DevOps Kubernetes platform engineer"
      )
      const backend = await seedVacancyTitled("backend", "Backend TypeScript developer")
      const rejected = await seedVacancyTitled("devops-reject", "DevOps manager")
      const archived = await seedVacancyTitled("devops-archived", "DevOps Kubernetes archived", {
        archived: true
      })

      // Two forms of the same keyword on one vacancy must count as one vacancy.
      await seedVacancyKeyword({ vacancyId: devops, keywordId: kubernetes, matchedForm: "kubernetes" })
      await seedVacancyKeyword({ vacancyId: devops, keywordId: kubernetes, matchedForm: "k8s" })
      await seedVacancyKeyword({ vacancyId: devops, keywordId: docker, matchedForm: "docker" })
      await seedVacancyKeyword({
        vacancyId: devopsPlatform,
        keywordId: kubernetes,
        matchedForm: "kubernetes"
      })
      await seedVacancyKeyword({
        vacancyId: devopsPlatform,
        keywordId: docker,
        matchedForm: "docker"
      })
      await seedVacancyKeyword({ vacancyId: backend, keywordId: typescript, matchedForm: "typescript" })
      await seedVacancyKeyword({ vacancyId: backend, keywordId: docker, matchedForm: "docker" })
      await seedVacancyKeyword({ vacancyId: rejected, keywordId: kubernetes, matchedForm: "kubernetes" })
      await seedVacancyKeyword({ vacancyId: archived, keywordId: kubernetes, matchedForm: "kubernetes" })

      // The "DevOps manager" vacancy is excluded by a title rule.
      const notManager = [{ field: "title", op: "not_contains", value: "manager" }]
      const devopsPreset = await seedPreset(tenant.userId, {
        title: "DevOps match",
        filter: { text: "DevOps", rules: notManager }
      })
      const backendPreset = await seedPreset(tenant.userId, {
        title: "Backend match",
        filter: { text: "Backend" }
      })

      const asCounts = (keywords: ReadonlyArray<{ term: string; vacancyCount: number }>) =>
        Object.fromEntries(keywords.map((keyword) => [keyword.term, keyword.vacancyCount]))

      const devopsKeywords = await lexiconList(tenant.userId, { presetId: devopsPreset })
      expect(asCounts(devopsKeywords)).toEqual({
        [`docker-${suffix}`]: 2,
        [`kubernetes-${suffix}`]: 2
      })

      const backendKeywords = await lexiconList(tenant.userId, { presetId: backendPreset })
      expect(asCounts(backendKeywords)).toEqual({
        [`docker-${suffix}`]: 1,
        [`typescript-${suffix}`]: 1
      })

      // Archived vacancies only join when the preset asks for them.
      const withArchived = await seedPreset(tenant.userId, {
        title: "DevOps match with archive",
        filter: { text: "DevOps", rules: notManager, includeArchived: true }
      })
      expect(asCounts(await lexiconList(tenant.userId, { presetId: withArchived }))).toEqual({
        [`docker-${suffix}`]: 2,
        [`kubernetes-${suffix}`]: 3
      })

      // keywordIds narrows the returned keyword list without changing counts.
      const dockerOnly = await seedPreset(tenant.userId, {
        title: "DevOps docker only",
        filter: { text: "DevOps", rules: notManager, keywordIds: [docker] }
      })
      const onlyDocker = await lexiconList(tenant.userId, { presetId: dockerOnly })
      expect(onlyDocker.map((keyword) => keyword.term)).toEqual([`docker-${suffix}`])
      expect(onlyDocker[0]?.vacancyCount).toBe(2)

      // Without a preset the whole lexicon is returned, still with active counts.
      const allKeywords = await lexiconList(tenant.userId, { query: suffix })
      expect(asCounts(allKeywords)).toEqual({
        [`docker-${suffix}`]: 3,
        [`kubernetes-${suffix}`]: 3,
        [`typescript-${suffix}`]: 1
      })

      // An unknown preset is a typed NotFound, not an empty keyword list.
      const missing = await lexiconListFailure(tenant.userId, { presetId: randomUUID() })
      expect(missing._tag).toBe("NotFound")
    })

    test("a stored preset filter with legacy gate / role_family decodes and is cleaned", async () => {
      const tenant = await seedTenant("preset-legacy-gate")
      const suffix = randomUUID().slice(0, 6)
      const title = { field: "title", op: "contains", value: `legacy-${suffix}` } as const
      const presetId = await seedPreset(tenant.userId, {
        title: "legacy",
        filter: {
          text: `legacy-${suffix}`,
          gate: "match",
          rules: [{ field: "gate", op: "eq", value: "match" }, title],
          groups: [
            {
              branches: [
                { rules: [{ field: "role_family", op: "eq", value: "devops" }] },
                { rules: [title] }
              ]
            }
          ]
        }
      })

      const stored = await findPreset(tenant.userId, presetId)
      expect(stored?.filter).toEqual({
        text: `legacy-${suffix}`,
        rules: [title],
        groups: [{ branches: [{ rules: [title] }] }]
      })
      // The cleaned filter also drives the keyword counts without failing.
      expect(await lexiconList(tenant.userId, { presetId })).toBeArray()
    })

    test("remove deletes only the caller's preset", async () => {
      const owner = await seedTenant("preset-remove")
      const other = await seedTenant("preset-remove-other")
      const presetId = await seedPreset(owner.userId, { title: "temporary" })

      expect(await removePreset(other.userId, presetId)).toBe(false)
      expect(String((await findPreset(owner.userId, presetId))?.id)).toBe(presetId)

      expect(await removePreset(owner.userId, presetId)).toBe(true)
      expect(await findPreset(owner.userId, presetId)).toBeNull()
    })

    test("the limit counts keywords, not alias rows", async () => {
      const tenant = await seedTenant("keyword-limit")
      const suffix = randomUUID().slice(0, 8)
      const alpha = await seedKeyword(`alpha-${suffix}`)
      await seedKeyword(`beta-${suffix}`)
      await seedKeywordAlias(alpha, `alpha-one-${suffix}`)
      await seedKeywordAlias(alpha, `alpha-two-${suffix}`)

      const limited = await lexiconList(tenant.userId, { query: suffix, limit: 2 })

      expect(limited.map((keyword) => keyword.term)).toEqual([
        `alpha-${suffix}`,
        `beta-${suffix}`
      ])
      expect(limited[0]?.aliases.map((alias) => alias.alias).sort()).toEqual([
        `alpha-one-${suffix}`,
        `alpha-two-${suffix}`
      ])
    })

    test("preview applies field rules and returns facets", async () => {
      const tenant = await seedTenant("preset-preview")
      const suffix = randomUUID().slice(0, 8)
      const keywordId = await seedKeyword(`preview-${suffix}`)

      const devopsTitle = `DevOps Kubernetes engineer ${suffix}`
      const backendTitle = `Backend TypeScript developer ${suffix}`
      const devops = await seedVacancyTitled("preview-devops", devopsTitle, {
        salaryFrom: 999_999,
        descriptionText: "Kubernetes and Terraform",
        workFormats: ["remote"]
      })
      const backend = await seedVacancyTitled("preview-backend", backendTitle, {
        salaryFrom: 111_111,
        descriptionText: "TypeScript and PostgreSQL",
        workFormats: ["office"]
      })
      await seedVacancySkill(devops, `Kube-${suffix}`)
      await seedVacancySkill(backend, `TypeScript-${suffix}`)
      await seedVacancyKeyword({
        vacancyId: devops,
        keywordId,
        matchedForm: `preview-${suffix}`,
        inSkills: true
      })

      const byTitle = await presetPreview(tenant.userId, {
        rules: [{ field: "title", op: "contains", value: devopsTitle }]
      })
      expect(byTitle.count).toBe(1)
      expect(byTitle.vacancies.map((vacancy) => vacancy.title)).toEqual([devopsTitle])

      const bySalary = await presetPreview(tenant.userId, {
        rules: [
          { field: "title", op: "contains", value: suffix },
          { field: "salary_from", op: "gte", value: 900_000 }
        ]
      })
      expect(bySalary.count).toBe(1)

      const bySkills = await presetPreview(tenant.userId, {
        rules: [{ field: "skills", op: "contains", value: `Kube-${suffix}` }]
      })
      expect(bySkills.count).toBe(1)
      expect(bySkills.skills.map((facet) => facet.term)).toContain(`Kube-${suffix}`)

      const byKeywords = await presetPreview(tenant.userId, {
        rules: [{ field: "keywords", op: "in", value: [`preview-${suffix}`] }]
      })
      expect(byKeywords.count).toBe(1)
      expect(byKeywords.keywords.map((facet) => facet.term)).toContain(`preview-${suffix}`)

      const byFormat = await presetPreview(tenant.userId, {
        rules: [
          { field: "title", op: "contains", value: suffix },
          { field: "work_format", op: "in", value: ["remote"] }
        ]
      })
      expect(byFormat.count).toBe(1)
    })

    test("the location narrows keywords to skills, body, title or text+skills", async () => {
      const tenant = await seedTenant("keyword-location")
      const suffix = randomUUID().slice(0, 8)
      const term = `loc-${suffix}`
      const keywordId = await seedKeyword(term)

      const inSkills = await seedVacancyTitled("loc-skills", "DevOps skills")
      const inBody = await seedVacancyTitled("loc-body", "DevOps body")
      const inBoth = await seedVacancyTitled("loc-both", "DevOps both")
      const inTitle = await seedVacancyTitled("loc-title", "DevOps title")
      const nowhere = await seedVacancyTitled("loc-none", "DevOps none")

      await seedVacancyKeyword({ vacancyId: inSkills, keywordId, matchedForm: term, inSkills: true })
      await seedVacancyKeyword({ vacancyId: inBody, keywordId, matchedForm: term, inBody: true })
      await seedVacancyKeyword({
        vacancyId: inBoth,
        keywordId,
        matchedForm: term,
        inBody: true,
        inSkills: true
      })
      await seedVacancyKeyword({ vacancyId: inTitle, keywordId, matchedForm: term, inTitle: true })
      await seedVacancyKeyword({ vacancyId: nowhere, keywordId, matchedForm: term })

      const countFor = async (location: "any" | "title" | "body" | "skills" | "text_or_skills") => {
        const rows = await lexiconList(tenant.userId, { query: suffix, location, limit: 100 })
        return rows.find((keyword) => keyword.term === term)?.vacancyCount
      }

      expect(await countFor("any")).toBe(5)
      expect(await countFor("skills")).toBe(2)
      expect(await countFor("body")).toBe(2)
      expect(await countFor("text_or_skills")).toBe(3)
      expect(await countFor("title")).toBe(1)
    })
  })
}
