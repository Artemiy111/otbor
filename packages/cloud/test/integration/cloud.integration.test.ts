/**
 * packages/cloud against a real Postgres.
 *
 * Opt-in on purpose: plain `bun test` never needs Docker. Run the suite with
 *
 *   bun run test:integration
 *
 * or point it at any reachable Postgres server:
 *
 *   OTBOR_TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres bun test
 *
 * The URL is a *server* address; its database name is ignored. Every run
 * creates a throwaway `otbor_it_<pid>_<random>` database, applies the real
 * migrations to it, and drops it in `afterAll`. The demo `otbor` database is
 * never opened for writes.
 */
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import {
  application,
  harness,
  harnessAccount,
  harnessJob,
  hhAccount
} from "../../src/db/tables.ts"
import {
  accountsFor,
  addAccount,
  claimAsHolder,
  completeJob,
  completeJobFailure,
  countJobs,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  enqueueSubmitJob,
  expireAccountLease,
  expireJobLease,
  findAccountLease,
  findApplication,
  findJob,
  harnessAccountRows,
  heartbeatJob,
  integrationEnabled,
  jobRowsForApplication,
  leaseNext,
  makeJobRunnable,
  migrateTestDatabase,
  recoverExpiredJobs,
  registerHarness,
  runAs,
  seedApplication,
  seedKit,
  seedTenant,
  seedVacancy,
  serverUrl,
  testDatabaseUrl
} from "./support.ts"

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

  /* ------------------------------------------------------------------------ */
  /* 1. Row level security                                                    */
  /* ------------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------------ */
  /* 2. Multi-account binding                                                 */
  /* ------------------------------------------------------------------------ */

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
      const alphaLease = await leaseNext(tenant.userId, alpha.id, [
        tenant.accountId,
        second,
        third
      ])
      expect(alphaLease.job?.id).toBe(jobSecond.id)

      const betaLease = await leaseNext(tenant.userId, beta.id, [
        tenant.accountId,
        second,
        third
      ])
      expect(betaLease.job?.id).toBe(jobFirst.id)

      const unbound = await leaseNext(tenant.userId, alpha.id, [third])
      expect(unbound.job).toBeNull()
      expect((await findJob(jobThird.id))?.status).toBe("pending")
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 3. Queue fencing                                                         */
  /* ------------------------------------------------------------------------ */

  describe("queue fencing", () => {
    test("heartbeat extends, stale epoch is rejected, expired lease returns to pending", async () => {
      const tenant = await seedTenant("fence")
      const h = await registerHarness(tenant.userId, [tenant.accountId])
      const job = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "prepare",
        maxAttempts: 3
      })

      const first = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(first.job?.id).toBe(job.id)
      expect(first.job?.leaseEpoch).toBe(1)
      const firstLeaseId = first.job!.leaseId!

      const beat = await heartbeatJob(tenant.userId, {
        harnessId: h.id,
        jobId: job.id,
        leaseId: firstLeaseId,
        epoch: first.job!.leaseEpoch
      })
      expect(beat).toEqual({ ok: true, reason: null })

      // A worker that lost the lease cannot complete with a newer epoch.
      const staleEpoch = await completeJobFailure(tenant.userId, {
        harnessId: h.id,
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

      const second = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(second.job?.id).toBe(job.id)
      expect(second.job?.leaseEpoch).toBe(2)

      // The previous holder's lease and epoch are now stale.
      const staleLease = await completeJobFailure(tenant.userId, {
        harnessId: h.id,
        jobId: job.id,
        leaseId: firstLeaseId,
        epoch: first.job!.leaseEpoch,
        exit: { tag: "permanent" }
      })
      expect(staleLease._tag).toBe("HarnessRejected")

      const done = await completeJob(tenant.userId, {
        harnessId: h.id,
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

      const leased = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(leased.job?.id).toBe(job.id)

      await expireJobLease(job.id)
      const recovered = await recoverExpiredJobs()
      expect(recovered).toContain(job.id)
      expect((await findJob(job.id))?.status).toBe("dead")
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 4. At-most-once submit                                                   */
  /* ------------------------------------------------------------------------ */

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
      const submitLease = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(submitLease.job?.id).toBe(first.id)
      expect(submitLease.job?.stage).toBe("submit")
      expect((await findApplication(appId))?.state).toBe("submitting")

      // The cloud does not trust "clicked": it parks the application in
      // reconcile instead of marking it submitted.
      const clicked = await completeJob(tenant.userId, {
        harnessId: h.id,
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
      const reconcileLease = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(String(reconcileLease.job?.id)).toBe(String(reconcileRow.id))
      expect(reconcileLease.job?.stage).toBe("reconcile")

      const confirmed = await completeJob(tenant.userId, {
        harnessId: h.id,
        jobId: reconcileLease.job!.id,
        leaseId: reconcileLease.job!.leaseId!,
        epoch: reconcileLease.job!.leaseEpoch,
        exit: { tag: "submitted" }
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
      const submitLease = await leaseNext(tenant.userId, h.id, [tenant.accountId])
      expect(submitLease.job?.stage).toBe("submit")

      // The harness is untrusted: "submitted" is not success.
      const trusted = await completeJob(tenant.userId, {
        harnessId: h.id,
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

  /* ------------------------------------------------------------------------ */
  /* 5. Account lease                                                         */
  /* ------------------------------------------------------------------------ */

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
  })
}
