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
import { InvalidInput } from "@otbor/contract"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer } from "effect"
import { Database } from "../../src/db/Database.ts"
import {
  application,
  harness,
  harnessAccount,
  harnessJob,
  hhAccount
} from "../../src/db/tables.ts"
import { CrawlRunner, type CrawlRunnerResult } from "../../src/services/CrawlRunner.ts"
import { ScheduleService } from "../../src/services/ScheduleService.ts"
import {
  accountsFor,
  addAccount,
  claimAsHolder,
  completeJob,
  completeJobFailure,
  countJobs,
  crawlFinish,
  crawlSavePage,
  crawlSavePageFailure,
  crawlStart,
  crawlStatus,
  createTestDatabase,
  dropTestDatabase,
  enqueueInference,
  enqueueJob,
  enqueueSubmitJob,
  expireAccountLease,
  expireJobLease,
  findAccountLease,
  findApplication,
  findJob,
  findPreset,
  findScheduleRow,
  findSearchQuery,
  getInference,
  getInferenceFailure,
  harnessAccountRows,
  heartbeatJob,
  insertRawJob,
  insertRawJobFailure,
  integrationEnabled,
  jobAccountId,
  jobRowsForApplication,
  leaseNext,
  lexiconList,
  lexiconListFailure,
  makeJobRunnable,
  migrateTestDatabase,
  recoverExpiredJobs,
  recordingRunner,
  registerHarness,
  removePreset,
  revokeHarness,
  runAs,
  runAsWithRunner,
  runDueSchedulesAs,
  scheduleRemove,
  scheduleRunNowFailure,
  scheduleRunNowWithRunner,
  scheduleRowsFor,
  scheduleUpsert,
  scheduleUpsertFailure,
  schedulesList,
  searchHitsFor,
  searchRunRowsFor,
  seedApplication,
  seedKeyword,
  seedKeywordAlias,
  seedKit,
  seedPreset,
  seedTenant,
  seedTitleVerdict,
  seedVacancy,
  seedVacancyKeyword,
  seedVacancyTitled,
  serverUrl,
  setDefaultAccount,
  setScheduleNextRun,
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

  /* ------------------------------------------------------------------------ */
  /* 6. Inference                                                             */
  /* ------------------------------------------------------------------------ */

  describe("inference", () => {
    test("enqueue creates an inference job and attaches the default account", async () => {
      const tenant = await seedTenant("inference-enqueue")
      // A second account is newer but not the default, so the service must
      // prefer `is_default` over insertion order.
      const second = await addAccount(tenant.userId, "inference-enqueue-second")
      await setDefaultAccount(tenant.userId, tenant.accountId)

      const prompt = `Write a cover letter ${randomUUID()}`
      const { job } = await enqueueInference(tenant.userId, {
        prompt,
        system: "You are a Russian career assistant",
        model: "opencode/big-pickle"
      })

      expect(job.kind).toBe("inference")
      expect(job.stage).toBe("inference")
      expect(job.status).toBe("pending")
      expect(job.maxAttempts).toBe(3)
      expect(job.payload).toEqual({
        prompt,
        system: "You are a Russian career assistant",
        model: "opencode/big-pickle"
      })
      // No account was supplied, so the user's default account is attached.
      expect(await jobAccountId(job.id)).toBe(tenant.accountId)
      expect(await jobAccountId(job.id)).not.toBe(second)

      const fetched = await getInference(tenant.userId, job.id)
      expect(fetched.payload).toEqual(job.payload)
    })

    test("an inference harness leases, completes and the artifacts round-trip", async () => {
      const tenant = await seedTenant("inference-run")
      const { job } = await enqueueInference(tenant.userId, {
        prompt: "Rate this vacancy",
        model: "opencode/big-pickle"
      })
      const h = await registerHarness(
        tenant.userId,
        [tenant.accountId],
        "inference-harness",
        ["inference"]
      )

      const leased = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId], [
        "inference"
      ])
      expect(leased.job?.id).toBe(job.id)
      expect(leased.job?.kind).toBe("inference")
      expect(leased.job?.stage).toBe("inference")

      const artifacts = {
        text: "Strong match",
        model: "opencode/big-pickle",
        usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.002 },
        durationMs: 1_500
      }

      const done = await completeJob(tenant.userId, {
        harnessId: h.id,
        token: h.token!,
        jobId: job.id,
        leaseId: leased.job!.leaseId!,
        epoch: leased.job!.leaseEpoch,
        exit: { tag: "prepared", artifacts }
      })
      expect(done.accepted).toBe(true)
      expect(done.status).toBe("done")

      const stored = await findJob(job.id)
      expect(stored?.status).toBe("done")
      expect(stored?.result).toEqual(artifacts)

      const fetched = await getInference(tenant.userId, job.id)
      expect(fetched.id).toBe(job.id)
      expect(fetched.kind).toBe("inference")
      expect(fetched.result).toEqual(artifacts)
    })

    test("inference_failed retries while attempts remain, then goes dead", async () => {
      const tenant = await seedTenant("inference-retry")
      const { job } = await enqueueInference(tenant.userId, { prompt: "retry me" })
      const h = await registerHarness(
        tenant.userId,
        [tenant.accountId],
        "inference-retry-harness",
        ["inference"]
      )

      const failOnce = async () => {
        const leased = await leaseNext(tenant.userId, h.id, h.token!, [tenant.accountId], [
          "inference"
        ])
        expect(leased.job?.id).toBe(job.id)
        return completeJob(tenant.userId, {
          harnessId: h.id,
          token: h.token!,
          jobId: job.id,
          leaseId: leased.job!.leaseId!,
          epoch: leased.job!.leaseEpoch,
          exit: { tag: "inference_failed", message: "agent exited 1" }
        })
      }

      const first = await failOnce()
      expect(first.status).toBe("pending")
      const retried = (await findJob(job.id))!
      expect(retried.status).toBe("pending")
      expect(retried.attempts).toBe(1)
      // The retry is delayed; make it runnable instead of sleeping.
      expect(new Date(retried.runAt).getTime()).toBeGreaterThan(Date.now())

      await makeJobRunnable(job.id)
      const second = await failOnce()
      expect(second.status).toBe("pending")
      expect((await findJob(job.id))?.attempts).toBe(2)

      await makeJobRunnable(job.id)
      const third = await failOnce()
      expect(third.status).toBe("dead")
      expect((await findJob(job.id))?.status).toBe("dead")
      expect((await findJob(job.id))?.attempts).toBe(3)
    })

    test("another user cannot read the inference job through RLS or InferenceGet", async () => {
      const a = await seedTenant("inference-rls-a")
      const b = await seedTenant("inference-rls-b")
      const { job } = await enqueueInference(b.userId, { prompt: "private prompt" })

      const error = await getInferenceFailure(a.userId, job.id)
      expect(error._tag).toBe("NotFound")

      const visible = await runAs(
        a.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(a.userId, (tx) =>
            tx.select({ id: harnessJob.id }).from(harnessJob).where(eq(harnessJob.id, job.id))
          )
        })
      )
      expect(visible).toHaveLength(0)

      // B still sees it, so the empty result is RLS rather than an empty table.
      const visibleToB = await runAs(
        b.userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(b.userId, (tx) =>
            tx.select({ id: harnessJob.id }).from(harnessJob).where(eq(harnessJob.id, job.id))
          )
        })
      )
      expect(visibleToB).toHaveLength(1)
      expect((await getInference(b.userId, job.id)).id).toBe(job.id)
    })

    test("migration 0006 accepts the inference stage and round-trips result", async () => {
      const tenant = await seedTenant("inference-migration")
      const result = {
        text: "round-trip",
        model: null,
        usage: { totalTokens: 12 },
        durationMs: 7
      }

      const id = await insertRawJob({
        userId: tenant.userId,
        stage: "inference",
        kind: "inference",
        result
      })

      const stored = await findJob(id)
      expect(stored?.stage).toBe("inference")
      expect(stored?.result).toEqual(result)

      // The recreated stage check still rejects a stage it does not know.
      const rejected = await insertRawJobFailure({
        userId: tenant.userId,
        stage: "not_a_stage"
      })
      // The Postgres constraint name survives inside the driver's cause chain.
      const reason = String((rejected as unknown as { cause?: unknown }).cause)
      expect(reason).toContain("harness_jobs_stage_check")
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 7. Crawl bookkeeping                                                     */
  /* ------------------------------------------------------------------------ */

  describe("crawl", () => {
    // Session noise and paging are dropped by `normalizeSearchUrl`, so the two
    // links below are the same saved search.
    const searchUrl = (text: string) =>
      `https://hh.ru/search/vacancy?text=${text}&area=1&search_session_id=${randomUUID()}`

    test("CrawlStart reuses search_query by normalized URL and starts a run", async () => {
      const tenant = await seedTenant("crawl-start")
      const url = searchUrl("typescript")

      const first = await crawlStart(tenant.userId, { url })
      expect(first.status).toBe("running")
      expect(first.nextPage).toBe(0)
      expect(first.pagesDone).toBe(0)
      expect(first.found).toBe(0)
      expect(first.error).toBeNull()
      expect(first.finishedAt).toBeNull()
      expect(first.normalizedUrl).not.toContain("search_session_id")

      // A run resumed at a later page and with a different session id is still
      // the same saved search.
      const second = await crawlStart(tenant.userId, {
        url: `${url.replace("area=1", "area=1&page=2")}`,
        startPage: 2
      })
      expect(second.queryId).toBe(first.queryId)
      expect(second.runId).not.toBe(first.runId)
      expect(second.normalizedUrl).toBe(first.normalizedUrl)
      expect(second.nextPage).toBe(2)

      const query = await findSearchQuery(first.normalizedUrl)
      expect(query?.id).toBe(first.queryId)
      expect(query?.textQuery).toBe("typescript")
      expect(query?.title).toBe("typescript")

      const runs = await searchRunRowsFor(first.queryId)
      expect(runs.map((run) => run.id).sort()).toEqual([first.runId, second.runId].sort())
    })

    test("CrawlSavePage advances the cursor and stores deduped hits", async () => {
      const tenant = await seedTenant("crawl-save")
      const v1 = await seedVacancy("crawl-save-1")
      const v2 = await seedVacancy("crawl-save-2")
      const v3 = await seedVacancy("crawl-save-3")
      const run = await crawlStart(tenant.userId, { url: searchUrl("effect") })

      // The same card twice on one page becomes one hit at the first position.
      const saved = await crawlSavePage(tenant.userId, {
        runId: run.runId,
        nextPage: 1,
        pagesDone: 1,
        found: 25,
        vacancyIds: [v1, v2, v2]
      })
      expect(saved.status).toBe("running")
      expect(saved.nextPage).toBe(1)
      expect(saved.pagesDone).toBe(1)
      expect(saved.found).toBe(25)

      const firstHits = await searchHitsFor(run.queryId)
      expect(firstHits.map((hit) => hit.vacancyId)).toEqual([v1, v2])
      expect(firstHits.map((hit) => hit.position)).toEqual([0, 1])

      // A later page overlaps with the previous one: (query, vacancy) is the
      // primary key, so the repeated card does not duplicate and the stored
      // position is not rewritten.
      const advanced = await crawlSavePage(tenant.userId, {
        runId: run.runId,
        nextPage: 2,
        pagesDone: 2,
        found: 41,
        vacancyIds: [v2, v3]
      })
      expect(advanced.nextPage).toBe(2)
      expect(advanced.pagesDone).toBe(2)
      expect(advanced.found).toBe(41)

      const hits = await searchHitsFor(run.queryId)
      expect(hits.map((hit) => hit.vacancyId).sort()).toEqual([v1, v2, v3].sort())
      expect(hits.find((hit) => hit.vacancyId === v2)?.position).toBe(1)
    })

    test("CrawlFinish stores done/stopped/error with finished_at", async () => {
      const tenant = await seedTenant("crawl-finish")
      const url = searchUrl("postgres")

      const doneRun = await crawlStart(tenant.userId, { url })
      const done = await crawlFinish(tenant.userId, {
        runId: doneRun.runId,
        status: "done",
        nextPage: 3,
        pagesDone: 3,
        found: 60
      })
      expect(done.status).toBe("done")
      expect(done.nextPage).toBe(3)
      expect(done.pagesDone).toBe(3)
      expect(done.found).toBe(60)
      expect(done.error).toBeNull()
      expect(done.finishedAt).not.toBeNull()

      const stoppedRun = await crawlStart(tenant.userId, { url })
      const stopped = await crawlFinish(tenant.userId, {
        runId: stoppedRun.runId,
        status: "stopped",
        nextPage: 2,
        pagesDone: 2,
        found: 40
      })
      expect(stopped.status).toBe("stopped")
      expect(stopped.error).toBeNull()
      expect(stopped.finishedAt).not.toBeNull()

      const errorRun = await crawlStart(tenant.userId, { url })
      const failed = await crawlFinish(tenant.userId, {
        runId: errorRun.runId,
        status: "error",
        nextPage: 1,
        pagesDone: 1,
        found: 20,
        error: "captcha on page 2"
      })
      expect(failed.status).toBe("error")
      expect(failed.error).toBe("captcha on page 2")
      expect(failed.finishedAt).not.toBeNull()

      // `finished_at` and the error text are persisted, not only echoed back.
      const rows = await searchRunRowsFor(doneRun.queryId)
      const storedError = rows.find((row) => row.id === errorRun.runId)
      expect(storedError?.status).toBe("error")
      expect(storedError?.error).toBe("captcha on page 2")
      expect(storedError?.finishedAt).not.toBeNull()
      expect(rows.find((row) => row.id === doneRun.runId)?.finishedAt).not.toBeNull()
    })

    test("a second run of the same URL reuses the query and keeps its own cursor", async () => {
      const tenant = await seedTenant("crawl-resume")
      const url = searchUrl("remote")
      const vacancyId = await seedVacancy("crawl-resume")

      const first = await crawlStart(tenant.userId, { url })
      await crawlSavePage(tenant.userId, {
        runId: first.runId,
        nextPage: 1,
        pagesDone: 1,
        found: 20,
        vacancyIds: [vacancyId]
      })
      const finished = await crawlFinish(tenant.userId, {
        runId: first.runId,
        status: "done",
        nextPage: 1,
        pagesDone: 1,
        found: 20
      })
      expect(finished.status).toBe("done")

      // Same search, new attempt: the saved query is reused, the run is new.
      const second = await crawlStart(tenant.userId, {
        url: `${url}&page=1`,
        startPage: 1
      })
      expect(second.queryId).toBe(first.queryId)
      expect(second.runId).not.toBe(first.runId)
      expect(second.status).toBe("running")
      expect(second.pagesDone).toBe(0)
      expect(second.found).toBe(0)
      expect(second.finishedAt).toBeNull()

      const runs = await searchRunRowsFor(first.queryId)
      expect(runs).toHaveLength(2)
      expect(runs.map((run) => run.id).sort()).toEqual([first.runId, second.runId].sort())
      expect(runs.find((run) => run.id === first.runId)?.status).toBe("done")
      expect(runs.find((run) => run.id === second.runId)?.status).toBe("running")

      // Hits belong to the query, so a second run rediscovering the same card
      // does not duplicate it.
      await crawlSavePage(tenant.userId, {
        runId: second.runId,
        nextPage: 2,
        pagesDone: 1,
        found: 10,
        vacancyIds: [vacancyId]
      })
      expect(await searchHitsFor(first.queryId)).toHaveLength(1)

      // The finished run stays finished; status is the run, not the query.
      expect((await crawlStatus(tenant.userId, first.runId)).status).toBe("done")
      expect((await crawlStatus(tenant.userId, second.runId)).status).toBe("running")
    })

    test("an unknown run is NotFound instead of a silent write", async () => {
      const tenant = await seedTenant("crawl-missing")
      const unknown = randomUUID()

      const error = await crawlSavePageFailure(tenant.userId, {
        runId: unknown,
        nextPage: 1,
        pagesDone: 1,
        found: 1,
        vacancyIds: []
      })
      expect(error._tag).toBe("NotFound")
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 8. Keyword presets                                                       */
  /* ------------------------------------------------------------------------ */

  describe("keyword presets", () => {
    test("two presets select different keyword sets and counts", async () => {
      const tenant = await seedTenant("keyword-presets")
      // Random suffixes keep the shared keyword table independent of other runs.
      const suffix = randomUUID().slice(0, 8)
      const docker = await seedKeyword(`docker-${suffix}`)
      const kubernetes = await seedKeyword(`kubernetes-${suffix}`)
      const typescript = await seedKeyword(`typescript-${suffix}`)

      const devops = await seedVacancyTitled("devops", "DevOps Kubernetes engineer")
      const devopsPlatform = await seedVacancyTitled(
        "devops-platform",
        "DevOps Kubernetes platform engineer"
      )
      const backend = await seedVacancyTitled("backend", "Backend TypeScript developer")
      const rejected = await seedVacancyTitled("devops-reject", "DevOps manager")
      const archived = await seedVacancyTitled("devops-archived", "DevOps Kubernetes archived", {
        archived: true
      })

      for (const title of [
        "DevOps Kubernetes engineer",
        "DevOps Kubernetes platform engineer",
        "Backend TypeScript developer",
        "DevOps Kubernetes archived"
      ]) {
        await seedTitleVerdict(title, "match")
      }
      await seedTitleVerdict("DevOps manager", "reject")

      // Two forms of the same keyword on one vacancy must count as one vacancy.
      await seedVacancyKeyword({ vacancyId: devops, keywordId: kubernetes, matchedForm: "kubernetes" })
      await seedVacancyKeyword({ vacancyId: devops, keywordId: kubernetes, matchedForm: "k8s" })
      await seedVacancyKeyword({ vacancyId: devops, keywordId: docker, matchedForm: "docker" })
      await seedVacancyKeyword({
        vacancyId: devopsPlatform,
        keywordId: kubernetes,
        matchedForm: "kubernetes"
      })
      await seedVacancyKeyword({
        vacancyId: devopsPlatform,
        keywordId: docker,
        matchedForm: "docker"
      })
      await seedVacancyKeyword({ vacancyId: backend, keywordId: typescript, matchedForm: "typescript" })
      await seedVacancyKeyword({ vacancyId: backend, keywordId: docker, matchedForm: "docker" })
      await seedVacancyKeyword({ vacancyId: rejected, keywordId: kubernetes, matchedForm: "kubernetes" })
      await seedVacancyKeyword({ vacancyId: archived, keywordId: kubernetes, matchedForm: "kubernetes" })

      const devopsPreset = await seedPreset(tenant.userId, {
        title: "DevOps match",
        filter: { text: "DevOps", gate: "match" }
      })
      const backendPreset = await seedPreset(tenant.userId, {
        title: "Backend match",
        filter: { text: "Backend", gate: "match" }
      })

      const asCounts = (keywords: ReadonlyArray<{ term: string; vacancyCount: number }>) =>
        Object.fromEntries(keywords.map((keyword) => [keyword.term, keyword.vacancyCount]))

      const devopsKeywords = await lexiconList(tenant.userId, { presetId: devopsPreset })
      expect(asCounts(devopsKeywords)).toEqual({
        [`docker-${suffix}`]: 2,
        [`kubernetes-${suffix}`]: 2
      })

      const backendKeywords = await lexiconList(tenant.userId, { presetId: backendPreset })
      expect(asCounts(backendKeywords)).toEqual({
        [`docker-${suffix}`]: 1,
        [`typescript-${suffix}`]: 1
      })

      // Archived vacancies only join when the preset asks for them.
      const withArchived = await seedPreset(tenant.userId, {
        title: "DevOps match with archive",
        filter: { text: "DevOps", gate: "match", includeArchived: true }
      })
      expect(asCounts(await lexiconList(tenant.userId, { presetId: withArchived }))).toEqual({
        [`docker-${suffix}`]: 2,
        [`kubernetes-${suffix}`]: 3
      })

      // keywordIds narrows the returned keyword list without changing counts.
      const dockerOnly = await seedPreset(tenant.userId, {
        title: "DevOps docker only",
        filter: { text: "DevOps", gate: "match", keywordIds: [docker] }
      })
      const onlyDocker = await lexiconList(tenant.userId, { presetId: dockerOnly })
      expect(onlyDocker.map((keyword) => keyword.term)).toEqual([`docker-${suffix}`])
      expect(onlyDocker[0]?.vacancyCount).toBe(2)

      // Without a preset the whole lexicon is returned, still with active counts.
      const allKeywords = await lexiconList(tenant.userId, { query: suffix })
      expect(asCounts(allKeywords)).toEqual({
        [`docker-${suffix}`]: 3,
        [`kubernetes-${suffix}`]: 3,
        [`typescript-${suffix}`]: 1
      })

      // An unknown preset is a typed NotFound, not an empty keyword list.
      const missing = await lexiconListFailure(tenant.userId, { presetId: randomUUID() })
      expect(missing._tag).toBe("NotFound")
    })

    test("remove deletes only the caller's preset", async () => {
      const owner = await seedTenant("preset-remove")
      const other = await seedTenant("preset-remove-other")
      const presetId = await seedPreset(owner.userId, { title: "temporary" })

      expect(await removePreset(other.userId, presetId)).toBe(false)
      expect(String((await findPreset(owner.userId, presetId))?.id)).toBe(presetId)

      expect(await removePreset(owner.userId, presetId)).toBe(true)
      expect(await findPreset(owner.userId, presetId)).toBeNull()
    })

    test("the limit counts keywords, not alias rows", async () => {
      const tenant = await seedTenant("keyword-limit")
      const suffix = randomUUID().slice(0, 8)
      const alpha = await seedKeyword(`alpha-${suffix}`)
      const beta = await seedKeyword(`beta-${suffix}`)
      await seedKeywordAlias(alpha, `alpha-one-${suffix}`)
      await seedKeywordAlias(alpha, `alpha-two-${suffix}`)

      const limited = await lexiconList(tenant.userId, { query: suffix, limit: 2 })

      expect(limited.map((keyword) => keyword.term)).toEqual([
        `alpha-${suffix}`,
        `beta-${suffix}`
      ])
      expect(limited[0]?.aliases.map((alias) => alias.alias).sort()).toEqual([
        `alpha-one-${suffix}`,
        `alpha-two-${suffix}`
      ])
    })

    test("the location narrows keywords to skills, body, title or text+skills", async () => {
      const tenant = await seedTenant("keyword-location")
      const suffix = randomUUID().slice(0, 8)
      const term = `loc-${suffix}`
      const keywordId = await seedKeyword(term)

      const inSkills = await seedVacancyTitled("loc-skills", "DevOps skills")
      const inBody = await seedVacancyTitled("loc-body", "DevOps body")
      const inBoth = await seedVacancyTitled("loc-both", "DevOps both")
      const inTitle = await seedVacancyTitled("loc-title", "DevOps title")
      const nowhere = await seedVacancyTitled("loc-none", "DevOps none")

      await seedVacancyKeyword({ vacancyId: inSkills, keywordId, matchedForm: term, inSkills: true })
      await seedVacancyKeyword({ vacancyId: inBody, keywordId, matchedForm: term, inBody: true })
      await seedVacancyKeyword({
        vacancyId: inBoth,
        keywordId,
        matchedForm: term,
        inBody: true,
        inSkills: true
      })
      await seedVacancyKeyword({ vacancyId: inTitle, keywordId, matchedForm: term, inTitle: true })
      await seedVacancyKeyword({ vacancyId: nowhere, keywordId, matchedForm: term })

      const countFor = async (location: "any" | "title" | "body" | "skills" | "text_or_skills") => {
        const rows = await lexiconList(tenant.userId, { query: suffix, location, limit: 100 })
        return rows.find((keyword) => keyword.term === term)?.vacancyCount
      }

      expect(await countFor("any")).toBe(5)
      expect(await countFor("skills")).toBe(2)
      expect(await countFor("body")).toBe(2)
      expect(await countFor("text_or_skills")).toBe(3)
      expect(await countFor("title")).toBe(1)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 8. Crawl schedules                                                       */
  /* ------------------------------------------------------------------------ */

  describe("crawl schedules", () => {
    const searchUrl = (text: string) => `https://hh.ru/search/vacancy?text=${text}&area=1`

    const cleanResult = (): CrawlRunnerResult => ({
      runId: randomUUID(),
      status: "done",
      reason: "last_page",
      error: null,
      pagesDone: 1,
      found: 2,
      inserted: 2,
      updated: 0,
      skipped: 0,
      errors: 0
    })

    test("upsert, list, update and remove are user-scoped", async () => {
      const a = await seedTenant("sched-a")
      const b = await seedTenant("sched-b")

      const created = await scheduleUpsert(a.userId, {
        targetId: searchUrl("typescript"),
        intervalMinutes: 60,
        enabled: true
      })
      expect(created.kind).toBe("search")
      expect(created.targetId).toBe(searchUrl("typescript"))
      expect(created.intervalMinutes).toBe(60)
      expect(created.enabled).toBe(true)
      expect(created.nextRunAt).not.toBeNull()
      expect(created.lastRunAt).toBeNull()
      expect(created.lastError).toBeNull()

      expect((await schedulesList(a.userId)).map((row) => row.id)).toEqual([created.id])
      expect(await schedulesList(b.userId)).toEqual([])

      const updated = await scheduleUpsert(a.userId, {
        id: created.id,
        targetId: searchUrl("effect"),
        intervalMinutes: 15,
        enabled: false
      })
      expect(updated.id).toBe(created.id)
      expect(updated.targetId).toBe(searchUrl("effect"))
      expect(updated.intervalMinutes).toBe(15)
      expect(updated.enabled).toBe(false)
      expect(updated.nextRunAt).toBeNull()

      // B cannot see or delete A's row.
      expect(await scheduleRemove(b.userId, created.id)).toMatchObject({ deleted: false })
      expect(await schedulesList(a.userId)).toHaveLength(1)
      expect(await scheduleRemove(a.userId, created.id)).toMatchObject({
        id: created.id,
        deleted: true
      })
      expect(await schedulesList(a.userId)).toEqual([])

      // runNow on a missing row is NotFound, not a silent accepted.
      const missing = await scheduleRunNowFailure(a.userId, randomUUID())
      expect(missing._tag).toBe("NotFound")
    })

    test("a bad interval or target is rejected before it reaches the table", async () => {
      const tenant = await seedTenant("sched-invalid")

      const badInterval = await scheduleUpsertFailure(tenant.userId, {
        targetId: searchUrl("devops"),
        intervalMinutes: 0
      })
      expect(badInterval._tag).toBe("InvalidInput")

      const badTarget = await scheduleUpsertFailure(tenant.userId, {
        targetId: "not a url",
        intervalMinutes: 30
      })
      expect(badTarget._tag).toBe("InvalidInput")
      expect(await scheduleRowsFor(tenant.userId)).toEqual([])
    })

    test("the worker claims only due searches and advances next_run_at", async () => {
      const tenant = await seedTenant("sched-due")
      const now = new Date("2026-11-02T12:00:00.000Z")

      const due = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("due"),
        intervalMinutes: 30
      })
      const future = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("future"),
        intervalMinutes: 60
      })
      const disabled = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("disabled"),
        intervalMinutes: 10,
        enabled: false
      })

      await setScheduleNextRun(due.id, new Date(now.getTime() - 60_000))
      await setScheduleNextRun(future.id, new Date(now.getTime() + 60_000))

      const targets: Array<string> = []
      const outcomes = await runDueSchedulesAs(tenant.userId, recordingRunner(targets), {
        now,
        limit: 10
      })

      expect(targets).toEqual([due.targetId])
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]).toMatchObject({ scheduleId: due.id, ok: true, error: null })

      const claimed = (await findScheduleRow(due.id))!
      expect(claimed.lastRunAt?.toISOString()).toBe(now.toISOString())
      expect(claimed.nextRunAt?.toISOString()).toBe(
        new Date(now.getTime() + 30 * 60_000).toISOString()
      )

      const untouched = (await findScheduleRow(future.id))!
      expect(untouched.lastRunAt).toBeNull()
      expect(untouched.nextRunAt?.toISOString()).toBe(
        new Date(now.getTime() + 60_000).toISOString()
      )
      const stillDisabled = (await findScheduleRow(disabled.id))!
      expect(stillDisabled.lastRunAt).toBeNull()
      expect(stillDisabled.nextRunAt).toBeNull()

      for (const row of [due, future, disabled]) {
        await scheduleRemove(tenant.userId, row.id)
      }
    })

    test("a failing schedule records last_error and does not stop the next one", async () => {
      const tenant = await seedTenant("sched-failure")
      const now = new Date("2026-11-02T13:00:00.000Z")

      const bad = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("blocked"),
        intervalMinutes: 30
      })
      const good = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("healthy"),
        intervalMinutes: 30
      })
      await setScheduleNextRun(bad.id, new Date(now.getTime() - 120_000))
      await setScheduleNextRun(good.id, new Date(now.getTime() - 60_000))

      const targets: Array<string> = []
      const runner = Layer.succeed(CrawlRunner, {
        run: (input) => {
          targets.push(input.url)
          return input.url === bad.targetId
            ? Effect.fail(new InvalidInput({ message: "hh is blocked" }))
            : Effect.succeed(cleanResult())
        }
      })

      const outcomes = await runDueSchedulesAs(tenant.userId, runner, { now, limit: 10 })

      expect(targets.sort()).toEqual([bad.targetId, good.targetId].sort())
      expect(outcomes).toHaveLength(2)
      expect(outcomes.find((row) => row.scheduleId === bad.id)).toMatchObject({
        ok: false,
        error: "hh is blocked"
      })
      expect(outcomes.find((row) => row.scheduleId === good.id)).toMatchObject({ ok: true })

      expect((await findScheduleRow(bad.id))?.lastError).toBe("hh is blocked")
      expect((await findScheduleRow(bad.id))?.lastRunAt).not.toBeNull()
      expect((await findScheduleRow(good.id))?.lastError).toBeNull()
      expect((await findScheduleRow(good.id))?.lastRunAt).not.toBeNull()

      await scheduleRemove(tenant.userId, bad.id)
      await scheduleRemove(tenant.userId, good.id)
    })

    test("run now accepts immediately and moves the next run forward", async () => {
      const tenant = await seedTenant("sched-run-now")
      const created = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("manual"),
        intervalMinutes: 45
      })

      const called = Deferred.makeUnsafe<void>()
      const targets: Array<string> = []
      const runner = Layer.succeed(CrawlRunner, {
        run: (input) =>
          Effect.gen(function*() {
            targets.push(input.url)
            yield* Deferred.succeed(called, undefined)
            return cleanResult()
          })
      })

      const accepted = await runAsWithRunner(
        tenant.userId,
        runner,
        Effect.gen(function*() {
          const schedules = yield* ScheduleService
          const result = yield* schedules.runNow(created.id)
          // Wait for the detached fiber to start, not for the crawl to end.
          yield* Deferred.await(called).pipe(Effect.timeout("2 seconds"))
          return result
        })
      )

      expect(accepted.accepted).toBe(true)
      expect(accepted.schedule.id).toBe(created.id)
      expect(accepted.schedule.lastRunAt).not.toBeNull()
      expect(accepted.schedule.nextRunAt).not.toBeNull()

      const lastRunAt = new Date(accepted.schedule.lastRunAt!).getTime()
      const nextRunAt = new Date(accepted.schedule.nextRunAt!).getTime()
      expect(nextRunAt - lastRunAt).toBe(45 * 60_000)
      expect(targets).toEqual([created.targetId])

      await scheduleRemove(tenant.userId, created.id)
    })
  })
}
