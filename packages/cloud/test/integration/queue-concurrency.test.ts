/** Integration: queue-concurrency. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { QueueService } from "../../src/services/QueueService.ts"
import {
  createTestDatabase,
  dropTestDatabase,
  enqueueInference,
  enqueueJob,
  integrationEnabled,
  migrateTestDatabase,
  ownerTx,
  registerHarness,
  runAs,
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
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await dropTestDatabase(base)
  }, 60_000)

  const snapshot = (userId: string) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.concurrency()
      })
    )

  const lease = (userId: string, harness: { id: string; token: string | null }, accountId: string, slots?: number) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.leaseNext({
          harnessId: harness.id,
          token: harness.token!,
          kinds: ["browser"],
          accounts: [accountId],
          ...(slots === undefined ? {} : { concurrency: slots })
        })
      })
    )

  describe("QueueConcurrencyGet", () => {
    test("shows slots, running and pending stages per account and the lease holder", async () => {
      const tenant = await seedTenant("conc-view")
      const harness = await registerHarness(tenant.userId, [tenant.accountId], "mac")
      for (const stage of ["form_read", "reconcile", "reconcile", "reconcile"] as const) {
        await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage })
      }
      await enqueueInference(tenant.userId, { prompt: "hi" })

      const before = await snapshot(tenant.userId)
      expect(before.harnesses.map((h) => [h.name, h.slots, h.busy])).toEqual([["mac", null, 0]])

      // The lease reports the slot count; two jobs are taken.
      expect((await lease(tenant.userId, harness, tenant.accountId, 6)).job).not.toBeNull()
      expect((await lease(tenant.userId, harness, tenant.accountId)).job).not.toBeNull()

      const view = await snapshot(tenant.userId)
      expect(view.browserCap).toBe(4)
      expect(view.actingCap).toBe(1)
      expect(view.submitIntervalSeconds).toBe(0)
      expect(view.harnesses[0]).toMatchObject({ name: "mac", slots: 6, busy: 2 })
      const account = view.accounts.find((a) => a.id === tenant.accountId)!
      expect(account.holderHarnessName).toBe("mac")
      expect(account.browserRunning).toBe(2)
      expect(account.actingRunning).toBe(0)
      expect(account.pendingTotal).toBe(2)
      expect(account.running.reduce((n, c) => n + c.count, 0)).toBe(2)
      expect(view.inference.pending).toBe(1)
      expect(account.nextSubmitAt).toBeNull()
      expect(account.submitBlockedAt).toBeNull()
    })

    test("shows the next allowed submit time and the captcha block of an account", async () => {
      const tenant = await seedTenant("conc-pause")
      await runAs(
        "owner",
        ownerTx((tx) =>
          tx.execute(sql`
            update hh_account
            set submit_next_at = now() + interval '80 seconds',
                submit_blocked_at = now() - interval '5 minutes',
                submit_block_reason = 'captcha'
            where id = ${tenant.accountId}
          `)
        )
      )
      const account = (await snapshot(tenant.userId)).accounts.find((a) => a.id === tenant.accountId)!
      expect(account.submitBlockReason).toBe("captcha")
      expect(Date.parse(account.submitBlockedAt!)).toBeLessThan(Date.now())
      expect(Date.parse(account.nextSubmitAt!)).toBeGreaterThan(Date.now() + 60_000)
    })

    test("does not show another user's harnesses or accounts", async () => {
      const mine = await seedTenant("conc-mine")
      const other = await seedTenant("conc-other")
      await registerHarness(other.userId, [other.accountId], "other-harness")
      const view = await snapshot(mine.userId)
      expect(view.harnesses.find((h) => h.name === "other-harness")).toBeUndefined()
      expect(view.accounts.find((a) => a.id === other.accountId)).toBeUndefined()
    })
  })
}
