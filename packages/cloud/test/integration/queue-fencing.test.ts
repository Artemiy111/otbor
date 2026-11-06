/** Integration: queue-fencing. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  completeJob,
  completeJobFailure,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  expireJobLease,
  findJob,
  heartbeatJob,
  integrationEnabled,
  leaseNext,
  migrateTestDatabase,
  recoverExpiredJobs,
  registerHarness,
  seedTenant,
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

  describe("queue fencing", () => {
    test("heartbeat extends, stale epoch is rejected, expired lease returns to pending", async () => {
      const tenant = await seedTenant("fence")
      const h = await registerHarness(tenant.userId, [tenant.accountId])
      const job = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "form_read",
        maxAttempts: 3
      })

      const first = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(first.job?.id).toBe(job.id)
      expect(first.job?.leaseEpoch).toBe(1)
      const firstLeaseId = first.job!.leaseId!

      const beat = await heartbeatJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: firstLeaseId,
        epoch: first.job!.leaseEpoch
      })
      expect(beat).toEqual({ ok: true, reason: null })

      // A worker that lost the lease cannot complete with a newer epoch.
      const staleEpoch = await completeJobFailure(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: firstLeaseId,
        epoch: first.job!.leaseEpoch + 1,
        exit: { tag: "permanent" }
      })
      expect(staleEpoch._tag).toBe("HarnessRejected")

      // Expire without sleeping: same effect as a worker that stopped polling.
      await expireJobLease(job.id)
      const recovered = await recoverExpiredJobs()
      expect(recovered).toContain(job.id)
      expect((await findJob(job.id))?.status).toBe("pending")
      expect((await findJob(job.id))?.leaseId).toBeNull()

      const second = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(second.job?.id).toBe(job.id)
      expect(second.job?.leaseEpoch).toBe(2)

      // The previous holder's lease and epoch are now stale.
      const staleLease = await completeJobFailure(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: firstLeaseId,
        epoch: first.job!.leaseEpoch,
        exit: { tag: "permanent" }
      })
      expect(staleLease._tag).toBe("HarnessRejected")

      const done = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: second.job!.leaseId!,
        epoch: second.job!.leaseEpoch,
        exit: { tag: "permanent" }
      })
      expect(done.accepted).toBe(true)
      expect(done.status).toBe("failed")
      expect((await findJob(job.id))?.status).toBe("failed")
    })

    test("an expired lease that exhausted attempts is buried as dead", async () => {
      const tenant = await seedTenant("dead")
      const h = await registerHarness(tenant.userId, [tenant.accountId])
      const job = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        maxAttempts: 1
      })

      const leased = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId])
      expect(leased.job?.id).toBe(job.id)

      await expireJobLease(job.id)
      const recovered = await recoverExpiredJobs()
      expect(recovered).toContain(job.id)
      expect((await findJob(job.id))?.status).toBe("dead")
    })
  })
}
