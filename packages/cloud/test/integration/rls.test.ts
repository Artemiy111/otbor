/** Integration: rls. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { application, harness, harnessAccount, harnessJob, hhAccount } from "../../src/db/tables.ts"
import {
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  integrationEnabled,
  migrateTestDatabase,
  registerHarness,
  runAs,
  seedApplication,
  seedTenant,
  seedVacancy,
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

  describe("RLS", () => {
    test("user A cannot read B's hh_account, harness, binding, application or job", async () => {
      const a = await seedTenant("rls-a")
      const b = await seedTenant("rls-b")
      const vacancyId = await seedVacancy("rls")
      const bHarness = await registerHarness(b.userId, [b.accountId], "b-harness")
      const bApplication = await seedApplication({
        userId: b.userId,
        accountId: b.accountId,
        vacancyId,
        state: "queued"
      })
      const bJob = await enqueueJob({
        userId: b.userId,
        accountId: b.accountId,
        applicationId: bApplication,
        stage: "prepare"
      })

      const visibleToA = await runAs(
        a.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(a.userId, (tx) =>
            Effect.gen(function*() {
              const accounts = yield* tx
                .select({ id: hhAccount.id })
                .from(hhAccount)
                .where(eq(hhAccount.id, b.accountId))
              const harnesses = yield* tx
                .select({ id: harness.id })
                .from(harness)
                .where(eq(harness.id, bHarness.id))
              const bindings = yield* tx
                .select({ harnessId: harnessAccount.harnessId })
                .from(harnessAccount)
                .where(eq(harnessAccount.hhAccountId, b.accountId))
              const applications = yield* tx
                .select({ id: application.id })
                .from(application)
                .where(eq(application.id, bApplication))
              const jobs = yield* tx
                .select({ id: harnessJob.id })
                .from(harnessJob)
                .where(eq(harnessJob.id, bJob.id))

              return {
                accounts: accounts.length,
                harnesses: harnesses.length,
                bindings: bindings.length,
                applications: applications.length,
                jobs: jobs.length
              }
            })
          )
        })
      )

      expect(visibleToA).toEqual({
        accounts: 0,
        harnesses: 0,
        bindings: 0,
        applications: 0,
        jobs: 0
      })

      // The same query as B sees every row, so the test is not just an empty table.
      const visibleToB = await runAs(
        b.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(b.userId, (tx) =>
            Effect.gen(function*() {
              const accounts = yield* tx
                .select({ id: hhAccount.id })
                .from(hhAccount)
                .where(eq(hhAccount.id, b.accountId))
              const applications = yield* tx
                .select({ id: application.id })
                .from(application)
                .where(eq(application.id, bApplication))
              const jobs = yield* tx
                .select({ id: harnessJob.id })
                .from(harnessJob)
                .where(eq(harnessJob.id, bJob.id))
              return {
                accounts: accounts.length,
                applications: applications.length,
                jobs: jobs.length
              }
            })
          )
        })
      )

      expect(visibleToB).toEqual({ accounts: 1, applications: 1, jobs: 1 })

      // A still sees its own account.
      const ownAccount = await runAs(
        a.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(a.userId, (tx) =>
            tx
              .select({ id: hhAccount.id })
              .from(hhAccount)
              .where(eq(hhAccount.id, a.accountId))
          )
        })
      )
      expect(ownAccount).toHaveLength(1)
    })
  })
}
