/** Integration: harness-binding. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  accountsFor,
  addAccount,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  findJob,
  harnessAccountRows,
  integrationEnabled,
  leaseNext,
  migrateTestDatabase,
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

  describe("harness binding", () => {
    test("one harness binds two accounts, an account moves, leases follow bindings", async () => {
      const tenant = await seedTenant("bind")
      const second = await addAccount(tenant.userId, "bind-second")
      const third = await addAccount(tenant.userId, "bind-third")

      const alpha = await registerHarness(
        tenant.userId,
        [tenant.accountId, second],
        "alpha"
      )
      expect([...alpha.accounts].map(String).sort()).toEqual(
        [tenant.accountId, second].sort()
      )
      expect(await accountsFor(alpha.id)).toEqual(expect.arrayContaining([tenant.accountId, second]))
      expect(await harnessAccountRows(tenant.accountId)).toHaveLength(1)

      const jobFirst = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare"
      })
      const jobSecond = await enqueueJob({
        userId: tenant.userId,
        accountId: second,
        stage: "prepare"
      })
      const jobThird = await enqueueJob({
        userId: tenant.userId,
        accountId: third,
        stage: "prepare"
      })

      // Rebinding an account moves it: the old row is deleted, not duplicated.
      const beta = await registerHarness(tenant.userId, [tenant.accountId], "beta")
      expect(await accountsFor(alpha.id)).toEqual([second])
      expect(await accountsFor(beta.id)).toEqual([tenant.accountId])
      expect(await harnessAccountRows(tenant.accountId)).toHaveLength(1)
      expect(await harnessAccountRows(third)).toHaveLength(0)

      // Even when the caller asks for every account, a harness only pulls its own.
      const alphaLease = await leaseNext(tenant.userId, alpha.id, alpha.token!, [
        tenant.accountId,
        second,
        third
      ])
      expect(alphaLease.job?.id).toBe(jobSecond.id)

      const betaLease = await leaseNext(tenant.userId, beta.id, beta.token!, [
        tenant.accountId,
        second,
        third
      ])
      expect(betaLease.job?.id).toBe(jobFirst.id)

      const unbound = await leaseNext(tenant.userId, alpha.id, alpha.token!, [third])
      expect(unbound.job).toBeNull()
      expect((await findJob(jobThird.id))?.status).toBe("pending")
    })
  })
}
