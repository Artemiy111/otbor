/** Integration: at-most-once-submit. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  completeJob,
  countJobs,
  createTestDatabase,
  dropTestDatabase,
  enqueueSubmitJob,
  findApplication,
  integrationEnabled,
  jobRowsForApplication,
  leaseNext,
  makeJobRunnable,
  migrateTestDatabase,
  registerHarness,
  seedApplication,
  seedKit,
  seedTenant,
  seedVacancy,
  serverUrl,
  testDatabaseUrl,
  vacancyExternalId
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

  describe("at-most-once submit", () => {
    test("one submit row, clicked goes to reconcile, reconcile confirms submitted", async () => {
      const tenant = await seedTenant("submit")
      const vacancyId = await seedVacancy("submit")
      const appId = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued"
      })
      const kit = await seedKit({ userId: tenant.userId, applicationId: appId })
      const canonicalUrl = `https://hh.ru/vacancy/integration-${randomUUID()}`

      const first = await enqueueSubmitJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId: appId,
        vacancyId,
        canonicalUrl,
        kit
      })
      const second = await enqueueSubmitJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId: appId,
        vacancyId,
        canonicalUrl,
        kit
      })

      expect(second.id).toBe(first.id)
      expect(await countJobs(appId, "submit")).toBe(1)

      const h = await registerHarness(tenant.userId, [tenant.accountId])
      const submitLease = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(submitLease.job?.id).toBe(first.id)
      expect(submitLease.job?.stage).toBe("submit")
      expect((await findApplication(appId))?.state).toBe("submitting")

      // The cloud does not trust "clicked": it parks the application in
      // reconcile instead of marking it submitted.
      const clicked = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: submitLease.job!.id,
        leaseId: submitLease.job!.leaseId!,
        epoch: submitLease.job!.leaseEpoch,
        exit: { tag: "clicked" }
      })
      expect(clicked.accepted).toBe(true)
      expect(clicked.status).toBe("needs_reconcile")

      expect(await countJobs(appId, "submit")).toBe(1)
      expect(await countJobs(appId, "reconcile")).toBe(1)
      expect((await findApplication(appId))?.state).toBe("submitting")

      const rows = await jobRowsForApplication(appId)
      const submitRow = rows.find((row) => row.stage === "submit")!
      expect(submitRow.status).toBe("needs_reconcile")
      const reconcileRow = rows.find((row) => row.stage === "reconcile")!
      expect(reconcileRow.status).toBe("pending")
      // Reconcile is deliberately delayed; the queue must not retry the click.
      expect(new Date(reconcileRow.runAt).getTime()).toBeGreaterThan(Date.now())

      await makeJobRunnable(reconcileRow.id)
      const reconcileLease = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(String(reconcileLease.job?.id)).toBe(String(reconcileRow.id))
      expect(reconcileLease.job?.stage).toBe("reconcile")

      const confirmed = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: reconcileLease.job!.id,
        leaseId: reconcileLease.job!.leaseId!,
        epoch: reconcileLease.job!.leaseEpoch,
        // Evidence, not a claim: the vacancy page shows the response.
        exit: {
          tag: "reconciled",
          artifacts: {
            externalId: await vacancyExternalId(vacancyId),
            vacancy: {
              url: `https://hh.ru/vacancy/${await vacancyExternalId(vacancyId)}`,
              html: '<h1 data-qa="vacancy-title">x</h1><a data-qa="vacancy-response-link-view-topic">Вы откликнулись</a>'
            },
            negotiations: []
          }
        }
      })
      expect(confirmed.accepted).toBe(true)
      expect(confirmed.status).toBe("done")

      const applicationRow = await findApplication(appId)
      expect(applicationRow?.state).toBe("submitted")
      expect(applicationRow?.submittedAt).not.toBeNull()
      expect(await countJobs(appId, "submit")).toBe(1)
      expect(await countJobs(appId, "reconcile")).toBe(1)
    })

    test("a harness-reported submitted is still parked in reconcile", async () => {
      const tenant = await seedTenant("submit-trust")
      const vacancyId = await seedVacancy("submit-trust")
      const appId = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued"
      })
      const kit = await seedKit({ userId: tenant.userId, applicationId: appId })

      await enqueueSubmitJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId: appId,
        vacancyId,
        canonicalUrl: `https://hh.ru/vacancy/integration-${randomUUID()}`,
        kit
      })

      const h = await registerHarness(tenant.userId, [tenant.accountId])
      const submitLease = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(submitLease.job?.stage).toBe("submit")

      // The harness is untrusted: "submitted" is not success.
      const trusted = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: submitLease.job!.id,
        leaseId: submitLease.job!.leaseId!,
        epoch: submitLease.job!.leaseEpoch,
        exit: { tag: "submitted" }
      })
      expect(trusted.accepted).toBe(true)
      expect(trusted.status).toBe("needs_reconcile")

      expect((await findApplication(appId))?.state).toBe("submitting")
      expect(await countJobs(appId, "reconcile")).toBe(1)
      expect(await countJobs(appId, "submit")).toBe(1)
    })
  })
}
