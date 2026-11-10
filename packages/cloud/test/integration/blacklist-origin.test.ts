/** Integration: происхождение и ссылки исключений, исключение для резюме вручную. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  addAccount,
  blacklistList,
  blacklistUpsert,
  blacklistUpsertFailure,
  createTestDatabase,
  dropTestDatabase,
  evaluateVacancy,
  hiddenTargetRowsFor,
  integrationEnabled,
  migrateTestDatabase,
  rejectVacancy,
  seedResume,
  seedTenant,
  seedVacancyForEmployer,
  serverUrl,
  testDatabaseUrl
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await dropTestDatabase(base)
  }, 60_000)

  const tag = () => randomUUID().slice(0, 8)

  const vacancyFor = (suffix: string) =>
    seedVacancyForEmployer({
      label: `orig-${suffix}`,
      title: `Go ${suffix}`,
      employerExternalId: `emp-${suffix}`,
      employerName: `Co ${suffix}`
    })

  describe("exclusions: origin", () => {
    test("кнопка пишет source = reject, ручная форма остаётся user", async () => {
      const tenant = await seedTenant("origin-split")
      const suffix = tag()
      const button = await vacancyFor(`b${suffix}`)
      const manual = await vacancyFor(`m${suffix}`)

      await rejectVacancy(tenant.userId, { vacancyId: button.vacancyId, scope: "app" })
      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "vacancy",
        externalId: manual.externalId
      })

      const rows = await hiddenTargetRowsFor(tenant.userId)
      const sourceOf = (externalId: string) => rows.find((row) => row.externalId === externalId)!.source
      expect(sourceOf(button.externalId)).toBe("reject")
      expect(sourceOf(manual.externalId)).toBe("user")

      const listed = await blacklistList(tenant.userId)
      expect(listed.items.find((i) => i.externalId === button.externalId)!.source).toBe("reject")
      expect(listed.items.find((i) => i.externalId === manual.externalId)!.source).toBe("user")
    })

    test("широкая отбраковка кнопкой стирает и кнопочные строки резюме", async () => {
      const tenant = await seedTenant("origin-cover")
      const accountId = await addAccount(tenant.userId, "main")
      const resumeId = await seedResume({ userId: tenant.userId, accountId, title: "A" })
      const vacancy = await vacancyFor(`c${tag()}`)
      await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "resume", resumeId })
      await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "app" })
      const rows = await hiddenTargetRowsFor(tenant.userId)
      expect(rows.map((row) => [row.scope, row.source])).toEqual([["app", "reject"]])
    })
  })

  describe("exclusions: internal ids", () => {
    test("список отдаёт id вакансии и работодателя из корпуса, а чужого номера не придумывает", async () => {
      const tenant = await seedTenant("ids")
      const vacancy = await vacancyFor(tag())
      await blacklistUpsert(tenant.userId, { scope: "app", targetType: "vacancy", externalId: vacancy.externalId })
      const employerExternal = `emp-${tag()}`
      await blacklistUpsert(tenant.userId, { scope: "app", targetType: "employer", externalId: employerExternal })
      const unknown = `nope-${tag()}`
      await blacklistUpsert(tenant.userId, { scope: "app", targetType: "vacancy", externalId: unknown })

      const { items } = await blacklistList(tenant.userId)
      const vacancyRow = items.find((i) => i.externalId === vacancy.externalId)!
      expect(String(vacancyRow.vacancyId)).toBe(vacancy.vacancyId)
      expect(vacancyRow.employerId).toBeNull()
      expect(items.find((i) => i.externalId === unknown)!.vacancyId).toBeNull()
      expect(items.find((i) => i.externalId === employerExternal)!.employerId).toBeNull()
    })

    test("работодатель из корпуса получает employerId", async () => {
      const tenant = await seedTenant("ids-emp")
      const suffix = tag()
      const vacancy = await vacancyFor(suffix)
      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `emp-${suffix}`
      })
      const { items } = await blacklistList(tenant.userId, { targetType: "employer" })
      expect(items).toHaveLength(1)
      expect(String(items[0]!.employerId)).toBe(vacancy.employerId)
      expect(items[0]!.vacancyId).toBeNull()
    })
  })

  describe("exclusions: per-resume upsert", () => {
    test("добавляет исключение для резюме вручную, оно действует на решение и остаётся user", async () => {
      const tenant = await seedTenant("resume-upsert")
      const accountId = await addAccount(tenant.userId, "main")
      const resumeA = await seedResume({ userId: tenant.userId, accountId, title: "A" })
      const resumeB = await seedResume({ userId: tenant.userId, accountId, title: "B" })
      const vacancy = await vacancyFor(tag())

      const record = await blacklistUpsert(tenant.userId, {
        scope: "resume",
        resumeId: resumeA,
        targetType: "vacancy",
        externalId: vacancy.externalId,
        reason: "не мой стек"
      })
      expect(record).toMatchObject({ scope: "resume", resumeId: resumeA, hhAccountId: null, source: "user" })
      // Повтор не плодит строку.
      await blacklistUpsert(tenant.userId, {
        scope: "resume",
        resumeId: resumeA,
        targetType: "vacancy",
        externalId: vacancy.externalId
      })
      expect(await hiddenTargetRowsFor(tenant.userId)).toHaveLength(1)

      const listed = await blacklistList(tenant.userId, { scope: "resume" })
      expect(listed.items[0]).toMatchObject({ resumeId: resumeA, vacancyId: vacancy.vacancyId })

      const blocked = await evaluateVacancy(tenant.userId, {
        vacancyId: vacancy.vacancyId,
        resumeId: resumeA,
        hhAccountId: accountId
      })
      expect(blocked.reasons.map((r) => r.code)).toContain("blocked_rejected")
      const other = await evaluateVacancy(tenant.userId, {
        vacancyId: vacancy.vacancyId,
        resumeId: resumeB,
        hhAccountId: accountId
      })
      expect(other.reasons.map((r) => r.code)).not.toContain("blocked_rejected")
    })

    test("отказывает без резюме, с аккаунтом, для работодателя и для чужого резюме", async () => {
      const tenant = await seedTenant("resume-validate")
      const stranger = await seedTenant("resume-stranger")
      const accountId = await addAccount(tenant.userId, "main")
      const mine = await seedResume({ userId: tenant.userId, accountId, title: "mine" })
      const theirs = await seedResume({ userId: stranger.userId, accountId: stranger.accountId, title: "theirs" })
      const externalId = `v-${tag()}`

      expect((await blacklistUpsertFailure(tenant.userId, { scope: "resume", targetType: "vacancy", externalId }))._tag)
        .toBe("InvalidInput")
      expect(
        (await blacklistUpsertFailure(tenant.userId, {
          scope: "resume",
          resumeId: mine,
          hhAccountId: accountId,
          targetType: "vacancy",
          externalId
        }))._tag
      ).toBe("InvalidInput")
      expect(
        (await blacklistUpsertFailure(tenant.userId, {
          scope: "resume",
          resumeId: mine,
          targetType: "employer",
          externalId
        }))._tag
      ).toBe("InvalidInput")
      expect(
        (await blacklistUpsertFailure(tenant.userId, {
          scope: "hh_account",
          hhAccountId: accountId,
          resumeId: mine,
          targetType: "vacancy",
          externalId
        }))._tag
      ).toBe("InvalidInput")
      expect(
        (await blacklistUpsertFailure(tenant.userId, {
          scope: "resume",
          resumeId: theirs,
          targetType: "vacancy",
          externalId
        }))._tag
      ).toBe("NotFound")
      expect(await hiddenTargetRowsFor(tenant.userId)).toHaveLength(0)
      expect(await hiddenTargetRowsFor(stranger.userId)).toHaveLength(0)
    })

    test("исключение для резюме не видно другому пользователю", async () => {
      const tenant = await seedTenant("resume-iso")
      const stranger = await seedTenant("resume-iso-2")
      const accountId = await addAccount(tenant.userId, "main")
      const resumeId = await seedResume({ userId: tenant.userId, accountId, title: "A" })
      await blacklistUpsert(tenant.userId, {
        scope: "resume",
        resumeId,
        targetType: "vacancy",
        externalId: `v-${tag()}`
      })
      expect((await blacklistList(stranger.userId)).total).toBe(0)
      expect((await blacklistList(tenant.userId)).total).toBe(1)
    })
  })
}
