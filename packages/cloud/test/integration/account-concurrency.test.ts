/** Integration: account-concurrency. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  claimAsHolder,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  findAccountLease,
  integrationEnabled,
  migrateTestDatabase,
  seedTenant,
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
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    await dropTestDatabase(base)
  }, 60_000)

  const holderName = () => `holder-${randomUUID().slice(0, 8)}`

  describe("browser concurrency per account", () => {
    test("one holder claims form_reads of an account up to the cap, a third waits", async () => {
      const tenant = await seedTenant("conc-reads")
      for (let i = 0; i < 3; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 10 - i })
      }
      const holder = holderName()
      const claim = () =>
        claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 2, actingConcurrency: 1 })

      // Two claims at once: both succeed, the lease row serializes them.
      const [one, two] = await Promise.all([claim(), claim()])
      expect(one).not.toBeNull()
      expect(two).not.toBeNull()
      expect(one!.job.id).not.toBe(two!.job.id)
      // The third waits: the account is at its cap for this holder.
      expect(await claim()).toBeNull()
    })

    test("many simultaneous claims never exceed the cap", async () => {
      const tenant = await seedTenant("conc-race")
      for (let i = 0; i < 8; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      }
      const holder = holderName()
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 3 })
        )
      )
      expect(results.filter((claimed) => claimed !== null)).toHaveLength(3)
    })

    test("acting stages are capped lower than reads", async () => {
      const tenant = await seedTenant("conc-acting")
      for (let i = 0; i < 3; i++) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit", priority: 100 })
      }
      const read = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "form_read",
        priority: 1
      })
      const holder = holderName()
      const claim = () =>
        claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 4, actingConcurrency: 2 })

      const stages: Array<string | undefined> = []
      for (let i = 0; i < 4; i++) stages.push((await claim())?.job.stage)
      // Two submits, the third submit is skipped, the read behind it is not blocked.
      expect(stages).toEqual(["submit", "submit", "form_read", undefined])
      expect(read.id).toBeDefined()
    })

    test("another holder cannot take an account leased by a live holder", async () => {
      const tenant = await seedTenant("conc-holders")
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      const first = holderName()
      const second = holderName()
      expect(await claimAsHolder({ holder: first, accounts: [tenant.accountId] })).not.toBeNull()
      expect(await claimAsHolder({ holder: second, accounts: [tenant.accountId] })).toBeNull()
      expect((await findAccountLease(tenant.accountId))?.holder).toBe(first)
      // The same holder still gets the second one.
      expect(await claimAsHolder({ holder: first, accounts: [tenant.accountId] })).not.toBeNull()
    })

    test("a busy account does not hold back inference or other accounts", async () => {
      const tenant = await seedTenant("conc-hol")
      const other = await seedTenant("conc-hol-other")
      const holder = holderName()
      const occupied = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      expect((await claimAsHolder({ holder, accounts: [tenant.accountId], browserConcurrency: 1 }))?.job.id).toBe(
        occupied.id
      )

      // The top-priority job belongs to the account that is now at its cap.
      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read", priority: 1000 })
      const inference = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "inference",
        kind: "inference",
        priority: 1
      })
      const claimed = await claimAsHolder({
        holder,
        accounts: [tenant.accountId, other.accountId],
        kinds: ["browser", "inference"],
        browserConcurrency: 1
      })
      expect(claimed?.job.id).toBe(inference.id)

      // The other account is not blocked either.
      const otherJob = await enqueueJob({ userId: other.userId, accountId: other.accountId, stage: "form_read" })
      const next = await claimAsHolder({
        holder,
        accounts: [tenant.accountId, other.accountId],
        browserConcurrency: 1
      })
      expect(next?.job.id).toBe(otherJob.id)
    })
  })
}
