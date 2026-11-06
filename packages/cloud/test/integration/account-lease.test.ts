/** Integration: account-lease. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  claimAsHolder,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  expireAccountLease,
  findAccountLease,
  findJob,
  integrationEnabled,
  leaseNext,
  makeJobRunnable,
  migrateTestDatabase,
  registerHarness,
  revokeHarness,
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

  describe("account lease", () => {
    test("two holders cannot serve the same account at the same time", async () => {
      const tenant = await seedTenant("account-lease")
      // Distinct priorities make each claim deterministic. The refused claim
      // pushes its candidate five seconds out, and the test makes it runnable
      // again instead of sleeping.
      const jobOne = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        priority: 100
      })
      const jobTwo = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        priority: 50
      })
      const jobThree = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare"
      })

      const holderOne = `holder-${randomUUID().slice(0, 8)}`
      const holderTwo = `holder-${randomUUID().slice(0, 8)}`

      const claimedByOne = await claimAsHolder({
        holder: holderOne,
        accounts: [tenant.accountId]
      })
      expect(claimedByOne?.job.id).toBe(jobOne.id)

      // The second holder is refused while the lease is live. Its candidate is
      // pushed five seconds out instead of being left leased.
      const refused = await claimAsHolder({
        holder: holderTwo,
        accounts: [tenant.accountId]
      })
      expect(refused).toBeNull()

      const liveLease = (await findAccountLease(tenant.accountId))!
      expect(liveLease.holder).toBe(holderOne)
      expect(liveLease.epoch).toBe(1)

      // After the holder dies, the lease is takeable by a different holder.
      await expireAccountLease(tenant.accountId)
      await makeJobRunnable(jobTwo.id)
      const takenOver = await claimAsHolder({
        holder: holderTwo,
        accounts: [tenant.accountId]
      })
      expect(takenOver?.job.id).toBe(jobTwo.id)

      const newLease = (await findAccountLease(tenant.accountId))!
      expect(newLease.holder).toBe(holderTwo)
      expect(newLease.epoch).toBe(2)

      // The old holder cannot steal it back while the new lease is live, even
      // though a third job is waiting.
      const stoleBack = await claimAsHolder({
        holder: holderOne,
        accounts: [tenant.accountId]
      })
      expect(stoleBack).toBeNull()
      expect((await findJob(jobThree.id))?.status).toBe("pending")
    })

    test("rebinding or revoking a harness releases the runtime account lease", async () => {
      const tenant = await seedTenant("account-lease-release")
      const first = await registerHarness(tenant.userId, [tenant.accountId], "release-first")
      const firstJob = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        priority: 100
      })

      const firstLease = await leaseNext(tenant.userId, first.id, first.token!, [
        tenant.accountId
      ])
      expect(firstLease.job?.id).toBe(firstJob.id)
      expect((await findAccountLease(tenant.accountId))?.holder).toBe(first.id)

      // Re-registering the account on another harness must not leave the old
      // 10-minute account lease behind.
      const second = await registerHarness(tenant.userId, [tenant.accountId], "release-second")
      expect(await findAccountLease(tenant.accountId)).toBeNull()

      const secondJob = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        priority: 200
      })
      const secondLease = await leaseNext(tenant.userId, second.id, second.token!, [
        tenant.accountId
      ])
      expect(secondLease.job?.id).toBe(secondJob.id)
      expect((await findAccountLease(tenant.accountId))?.holder).toBe(second.id)

      await revokeHarness(tenant.userId, second.id)
      expect(await findAccountLease(tenant.accountId)).toBeNull()
    })
  })
}
