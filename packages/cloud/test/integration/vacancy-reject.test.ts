/** Integration: отбраковка вакансии для резюме, аккаунта и всех. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { application } from "../../src/db/tables.ts"
import {
  addAccount,
  createTestDatabase,
  dropTestDatabase,
  evaluateVacancy,
  hiddenTargetRowsFor,
  integrationEnabled,
  migrateTestDatabase,
  rejectVacancy,
  seedApplication,
  seedResume,
  seedTenant,
  seedVacancyForEmployer,
  serverUrl,
  testDatabaseUrl,
  unrejectVacancy
} from "./support/index.ts"
import { runAs } from "./support/layers.ts"
import { ownerTx } from "./support/seeds.ts"

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

  const stateOf = (applicationId: string) =>
    runAs(
      "owner",
      ownerTx((tx) => tx.select({ state: application.state }).from(application).where(eq(application.id, applicationId)))
    ).then((rows) => rows[0]!.state)

  const firstReason = async (userId: string, input: Parameters<typeof evaluateVacancy>[1]) =>
    (await evaluateVacancy(userId, input)).reasons[0]!.code

  const tag = () => randomUUID().slice(0, 8)

  describe("vacancy reject", () => {
    test("для резюме: другое резюме того же аккаунта не затронуто, заявка этого уходит в skipped", async () => {
      const tenant = await seedTenant("reject-resume")
      const accountId = await addAccount(tenant.userId, "main")
      const resumeA = await seedResume({ userId: tenant.userId, accountId, title: "A" })
      const resumeB = await seedResume({ userId: tenant.userId, accountId, title: "B" })
      const suffix = tag()
      const vacancy = await seedVacancyForEmployer({
        label: `rej-${suffix}`,
        title: `DevOps ${suffix}`,
        employerExternalId: `emp-${suffix}`,
        employerName: `Co ${suffix}`
      })
      const draftA = await seedApplication({
        userId: tenant.userId,
        accountId,
        vacancyId: vacancy.vacancyId,
        resumeId: resumeA,
        state: "draft"
      })
      const draftB = await seedApplication({
        userId: tenant.userId,
        accountId,
        vacancyId: vacancy.vacancyId,
        resumeId: resumeB,
        state: "draft"
      })

      const result = await rejectVacancy(tenant.userId, {
        vacancyId: vacancy.vacancyId,
        scope: "resume",
        resumeId: resumeA
      })
      expect(result.skippedApplications).toBe(1)
      expect(result.rejection.scope).toBe("resume")
      expect(await stateOf(draftA)).toBe("skipped")
      expect(await stateOf(draftB)).toBe("draft")

      expect(await firstReason(tenant.userId, { vacancyId: vacancy.vacancyId, hhAccountId: accountId, resumeId: resumeA }))
        .toBe("blocked_rejected")
      expect(await firstReason(tenant.userId, { vacancyId: vacancy.vacancyId, hhAccountId: accountId, resumeId: resumeB }))
        .not.toBe("blocked_rejected")

      // Снятие возвращает обычное решение.
      expect(await unrejectVacancy(tenant.userId, result.rejection.id)).toBe(true)
      expect(await stateOf(draftA)).toBe("draft")
      expect(await firstReason(tenant.userId, { vacancyId: vacancy.vacancyId, hhAccountId: accountId, resumeId: resumeA }))
        .not.toBe("blocked_rejected")
    })

    test("для всех: действует на все аккаунты пользователя, узкие строки стираются, чужой пользователь не затронут", async () => {
      const tenant = await seedTenant("reject-app")
      const other = await seedTenant("reject-app-other")
      const accountA = await addAccount(tenant.userId, "a")
      const accountB = await addAccount(tenant.userId, "b")
      const resumeA = await seedResume({ userId: tenant.userId, accountId: accountA, title: "A" })
      const resumeB = await seedResume({ userId: tenant.userId, accountId: accountB, title: "B" })
      const otherAccount = await addAccount(other.userId, "o")
      const otherResume = await seedResume({ userId: other.userId, accountId: otherAccount, title: "O" })
      const suffix = tag()
      const vacancy = await seedVacancyForEmployer({
        label: `rej-${suffix}`,
        title: `DevOps ${suffix}`,
        employerExternalId: `emp-${suffix}`,
        employerName: `Co ${suffix}`
      })

      await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "resume", resumeId: resumeA })
      await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "hh_account", hhAccountId: accountB })
      expect((await hiddenTargetRowsFor(tenant.userId)).length).toBe(2)

      await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "app", reason: "не то" })
      const rows = await hiddenTargetRowsFor(tenant.userId)
      expect(rows.map((row) => row.scope)).toEqual(["app"])

      for (const [hhAccountId, resumeId] of [[accountA, resumeA], [accountB, resumeB]] as const) {
        expect(await firstReason(tenant.userId, { vacancyId: vacancy.vacancyId, hhAccountId, resumeId }))
          .toBe("blocked_rejected")
      }
      expect(await firstReason(other.userId, { vacancyId: vacancy.vacancyId, hhAccountId: otherAccount, resumeId: otherResume }))
        .not.toBe("blocked_rejected")
    })

    test("отправленный отклик не трогается", async () => {
      const tenant = await seedTenant("reject-submitted")
      const accountId = await addAccount(tenant.userId, "main")
      const resumeId = await seedResume({ userId: tenant.userId, accountId, title: "A" })
      const suffix = tag()
      const vacancy = await seedVacancyForEmployer({
        label: `rej-${suffix}`,
        title: `DevOps ${suffix}`,
        employerExternalId: `emp-${suffix}`,
        employerName: `Co ${suffix}`
      })
      const sent = await seedApplication({
        userId: tenant.userId,
        accountId,
        vacancyId: vacancy.vacancyId,
        resumeId,
        state: "submitted"
      })
      const result = await rejectVacancy(tenant.userId, { vacancyId: vacancy.vacancyId, scope: "app" })
      expect(result.skippedApplications).toBe(0)
      expect(await stateOf(sent)).toBe("submitted")
    })
  })
}
