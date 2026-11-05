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
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { InvalidInput, type VacancyDraft } from "@otbor/contract"
import { FakeMailGateway, accountSecretExists, type MailMessage } from "@otbor/mail"
import {
  FakeTelegramGateway,
  readSession,
  type TelegramDialog,
  type TelegramMessage
} from "@otbor/telegram"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import {
  application,
  harness,
  harnessAccount,
  harnessJob,
  hhAccount
} from "../../src/db/tables.ts"
import { CrawlRunner, type CrawlRunnerResult } from "../../src/services/CrawlRunner.ts"
import { HydrationRunner, type HydrationRunResult } from "../../src/services/HydrationRunner.ts"
import { ScheduleService } from "../../src/services/ScheduleService.ts"
import { TelegramService } from "../../src/services/TelegramService.ts"
import {
  accountsFor,
  addAccount,
  blacklistImportHh,
  blacklistList,
  blacklistUpsert,
  blacklistUpsertFailure,
  claimAsHolder,
  completeJob,
  completeJobFailure,
  contactRemove,
  contactRowsFor,
  contactsList,
  conversationGet,
  conversationGetFailure,
  conversationRowsFor,
  conversationVacanciesFor,
  conversationsList,
  corpusIngest,
  corpusList,
  countJobs,
  crawlFinish,
  crawlRunsList,
  crawlSavePage,
  crawlSavePageFailure,
  crawlStart,
  crawlStatus,
  createTestDatabase,
  dropTestDatabase,
  enqueueInference,
  enqueueJob,
  enqueueSubmitJob,
  evaluateVacancy,
  employersList,
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
  hiddenTargetRowsFor,
  insertRawJob,
  insertRawJobFailure,
  integrationEnabled,
  jobAccountId,
  jobRowsForApplication,
  leaseNext,
  lexiconList,
  lexiconListFailure,
  mailAccountRemove,
  mailAccountTest,
  mailAccountUpsert,
  mailAccountUpsertFailure,
  mailAccountsList,
  mailAccountRowsFor,
  mailFolderRowsFor,
  mailMessageRowsFor,
  mailSyncNow,
  makeJobRunnable,
  migrateTestDatabase,
  recoverExpiredJobs,  resetMailFolderCursor,
  presetPreview,
  recordingRunner,
  registerHarness,
  removePreset,
  revokeHarness,
  runAs,
  runAsWithOptions,
  runAsWithRunner,
  runDueSchedulesAs,
  runDueSchedulesWithGateways,
  scheduleRemove,
  scheduleRunNowFailure,
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
  seedVacancyForEmployer,
  seedVacancyKeyword,
  seedVacancySkill,
  seedVacancyTitled,
  seedVacancyWithExternal,
  vacancyExternalId,
  serverUrl,
  setDefaultAccount,
  setScheduleNextRun,
  telegramAccountRemove,
  telegramAccountRowsFor,
  telegramAccountUpsert,
  telegramAccountUpsertFailure,
  telegramAccountsList,
  telegramSyncNow,
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

    test("CrawlRunsList returns completed runs with counts", async () => {
      const tenant = await seedTenant("crawl-runs-list")
      const url = searchUrl("counts")

      const run = await crawlStart(tenant.userId, { url })
      const finished = await crawlFinish(tenant.userId, {
        runId: run.runId,
        status: "done",
        nextPage: 3,
        pagesDone: 3,
        found: 60,
        inserted: 40,
        updated: 10,
        skipped: 10
      })
      expect(finished.inserted).toBe(40)
      expect(finished.updated).toBe(10)
      expect(finished.skipped).toBe(10)

      const listed = await crawlRunsList(tenant.userId, { url })
      expect(listed.total).toBeGreaterThanOrEqual(1)
      const item = listed.items.find((r) => r.runId === run.runId)
      expect(item).toBeDefined()
      expect(item?.inserted).toBe(40)
      expect(item?.updated).toBe(10)
      expect(item?.skipped).toBe(10)

      const byQuery = await crawlRunsList(tenant.userId, { queryId: run.queryId })
      expect(byQuery.items.some((r) => r.runId === run.runId)).toBe(true)
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
      await seedKeyword(`beta-${suffix}`)
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

    test("preview applies field rules and returns facets", async () => {
      const tenant = await seedTenant("preset-preview")
      const suffix = randomUUID().slice(0, 8)
      const keywordId = await seedKeyword(`preview-${suffix}`)

      const devopsTitle = `DevOps Kubernetes engineer ${suffix}`
      const backendTitle = `Backend TypeScript developer ${suffix}`
      const devops = await seedVacancyTitled("preview-devops", devopsTitle, {
        salaryFrom: 999_999,
        descriptionText: "Kubernetes and Terraform",
        workFormats: ["remote"]
      })
      const backend = await seedVacancyTitled("preview-backend", backendTitle, {
        salaryFrom: 111_111,
        descriptionText: "TypeScript and PostgreSQL",
        workFormats: ["office"]
      })
      await seedTitleVerdict(devopsTitle, "match")
      await seedTitleVerdict(backendTitle, "reject")
      await seedVacancySkill(devops, `Kube-${suffix}`)
      await seedVacancySkill(backend, `TypeScript-${suffix}`)
      await seedVacancyKeyword({
        vacancyId: devops,
        keywordId,
        matchedForm: `preview-${suffix}`,
        inSkills: true
      })

      const byTitle = await presetPreview(tenant.userId, {
        rules: [{ field: "title", op: "contains", value: devopsTitle }]
      })
      expect(byTitle.count).toBe(1)
      expect(byTitle.vacancies.map((vacancy) => vacancy.title)).toEqual([devopsTitle])

      const bySalary = await presetPreview(tenant.userId, {
        rules: [
          { field: "title", op: "contains", value: suffix },
          { field: "salary_from", op: "gte", value: 900_000 }
        ]
      })
      expect(bySalary.count).toBe(1)

      const byGate = await presetPreview(tenant.userId, {
        rules: [
          { field: "title", op: "contains", value: suffix },
          { field: "gate", op: "eq", value: "match" }
        ]
      })
      expect(byGate.count).toBe(1)

      const bySkills = await presetPreview(tenant.userId, {
        rules: [{ field: "skills", op: "contains", value: `Kube-${suffix}` }]
      })
      expect(bySkills.count).toBe(1)
      expect(bySkills.skills.map((facet) => facet.term)).toContain(`Kube-${suffix}`)

      const byKeywords = await presetPreview(tenant.userId, {
        rules: [{ field: "keywords", op: "in", value: [`preview-${suffix}`] }]
      })
      expect(byKeywords.count).toBe(1)
      expect(byKeywords.keywords.map((facet) => facet.term)).toContain(`preview-${suffix}`)

      const byFormat = await presetPreview(tenant.userId, {
        rules: [
          { field: "title", op: "contains", value: suffix },
          { field: "work_format", op: "in", value: ["remote"] }
        ]
      })
      expect(byFormat.count).toBe(1)
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
      const runner = Layer.succeed(CrawlRunner, CrawlRunner.of({
        run: (input) => {
          targets.push(input.url)
          return input.url === bad.targetId
            ? Effect.fail(new InvalidInput({ message: "hh is blocked" }))
            : Effect.succeed(cleanResult())
        }
      }))

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
      const runner = Layer.succeed(CrawlRunner, CrawlRunner.of({
        run: (input) =>
          Effect.gen(function*() {
            targets.push(input.url)
            yield* Deferred.succeed(called, undefined)
            return cleanResult()
          })
      }))

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

  /* ------------------------------------------------------------------------ */
  /* 9. Sources: contacts, mail, Telegram, schedule dispatch                  */
  /* ------------------------------------------------------------------------ */

  describe("sources", () => {
    const previousMailDir = process.env.OTBOR_MAIL_DIR
    const previousTelegramDir = process.env.OTBOR_TELEGRAM_DIR
    let mailDir = ""
    let telegramDir = ""

    beforeAll(async () => {
      mailDir = await mkdtemp(join(tmpdir(), "otbor-mail-"))
      telegramDir = await mkdtemp(join(tmpdir(), "otbor-telegram-"))
      process.env.OTBOR_MAIL_DIR = mailDir
      process.env.OTBOR_TELEGRAM_DIR = telegramDir
    })

    afterAll(async () => {
      if (previousMailDir === undefined) delete process.env.OTBOR_MAIL_DIR
      else process.env.OTBOR_MAIL_DIR = previousMailDir
      if (previousTelegramDir === undefined) delete process.env.OTBOR_TELEGRAM_DIR
      else process.env.OTBOR_TELEGRAM_DIR = previousTelegramDir
      await rm(mailDir, { recursive: true, force: true })
      await rm(telegramDir, { recursive: true, force: true })
    })

    const uniqueDigits = (): string =>
      `${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

    const mailMessage = (
      input: Pick<MailMessage, "folder" | "uid" | "rfcMessageId"> & Partial<MailMessage>
    ): MailMessage => ({
      inReplyTo: null,
      references: [],
      from: [],
      to: [],
      cc: [],
      subject: null,
      sentAt: null,
      receivedAt: new Date().toISOString(),
      text: "",
      snippet: "",
      listId: null,
      authResults: null,
      attachmentCount: 0,
      attachmentNames: [],
      size: 0,
      ...input
    })

    const telegramMessage = (
      id: string,
      direction: "in" | "out",
      text: string
    ): TelegramMessage => ({
      id,
      direction,
      sentAt: new Date().toISOString(),
      editedAt: null,
      kind: "text",
      text,
      replyToId: null
    })

    test("vacancy ingestion extracts contacts scoped to the owner", async () => {
      const a = await seedTenant("src-contacts-a")
      const b = await seedTenant("src-contacts-b")
      const externalId = `v-${randomUUID().slice(0, 8)}`

      const draft: VacancyDraft = {
        externalId,
        canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
        title: "Senior DevOps Engineer",
        descriptionText: [
          "Свяжитесь с HR Анной: anna@acme.dev",
          "Telegram: @acme_hr",
          "Телефон: +7 (999) 123-45-67"
        ].join("\n"),
        employer: { externalId: `e-${externalId}`, name: "Acme" }
      }

      const saved = await corpusIngest(a.userId, [draft])
      expect(saved.inserted).toBe(1)

      const list = await contactsList(a.userId, { source: "hh_vacancy" })
      expect(list.total).toBe(3)
      expect(list.items.map((contact) => `${contact.kind}:${contact.value}`).sort()).toEqual(
        ["email:anna@acme.dev", "phone:+79991234567", "telegram:@acme_hr"].sort()
      )
      for (const contact of list.items) {
        expect(contact.vacancyId).toBe(saved.items[0]!.id)
        expect(contact.source).toBe("hh_vacancy")
        expect(contact.evidence).toBeTruthy()
      }

      const email = list.items.find((contact) => contact.kind === "email")!
      expect(email.personName).toBeNull()

      expect(await contactsList(b.userId)).toEqual({ items: [], total: 0 })
      expect(await contactRemove(b.userId, email.id)).toMatchObject({ deleted: false })
      expect(await contactRowsFor(a.userId)).toHaveLength(3)
      expect(await contactRemove(a.userId, email.id)).toMatchObject({
        id: email.id,
        deleted: true
      })
      expect((await contactsList(a.userId, { kind: "phone" })).total).toBe(1)
      expect((await contactsList(a.userId, { query: "@acme" })).total).toBe(1)
    })

    test("mail account CRUD, fake sync and idempotency", async () => {
      const a = await seedTenant("src-mail-a")
      const b = await seedTenant("src-mail-b")

      const externalId = uniqueDigits()
      const vacancyId = await seedVacancyWithExternal(externalId, "Senior DevOps")

      const messages: MailMessage[] = [
        mailMessage({
          folder: "INBOX",
          uid: 1,
          rfcMessageId: "root@acme.dev",
          from: [{ name: "Anna HR", address: "Anna@Acme.dev" }],
          to: [{ name: "Me", address: "me@acme.dev" }],
          subject: "Senior DevOps vacancy",
          sentAt: new Date("2026-11-01T09:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T09:00:00.000Z").toISOString(),
          text: `Пишите: anna@acme.dev, Telegram @acme_hr, +7 999 123-45-67. Вакансия https://hh.ru/vacancy/${externalId}`,
          snippet: "Пишите: anna@acme.dev"
        }),
        mailMessage({
          folder: "Sent",
          uid: 2,
          rfcMessageId: "reply@acme.dev",
          inReplyTo: "root@acme.dev",
          references: ["root@acme.dev"],
          from: [{ name: "Me", address: "me@acme.dev" }],
          to: [{ name: "Anna HR", address: "anna@acme.dev" }],
          subject: "Re: Senior DevOps vacancy",
          sentAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
          text: "Спасибо, откликнулся.",
          snippet: "Спасибо"
        }),
        mailMessage({
          folder: "INBOX",
          uid: 3,
          rfcMessageId: "other@other.dev",
          from: [{ name: "Bob", address: "bob@other.dev" }],
          to: [{ name: "Me", address: "me@acme.dev" }],
          subject: "Another role",
          sentAt: new Date("2026-11-01T11:00:00.000Z").toISOString(),
          receivedAt: new Date("2026-11-01T11:00:00.000Z").toISOString(),
          text: "Здравствуйте, есть другая вакансия.",
          snippet: "Здравствуйте"
        })
      ]

      const fake = new FakeMailGateway({ address: "me@acme.dev", messages })
      const account = await mailAccountUpsert(a.userId, {
        label: "work",
        address: "me@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "me@acme.dev",
        password: "app-password",
        includeSent: true,
        backfillDays: 90
      })

      expect(account.status).toBe("idle")
      expect(account.includeSent).toBe(true)
      expect(await accountSecretExists(account.id)).toBe(true)
      expect((await mailAccountsList(a.userId)).map((row) => row.id)).toEqual([account.id])
      expect(await mailAccountsList(b.userId)).toEqual([])

      const probe = await mailAccountTest(a.userId, account.id, { mailGateway: fake })
      expect(probe).toMatchObject({ ok: true, address: "me@acme.dev", folders: 2 })

      const first = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(first.processed).toBe(3)
      expect(first.inserted).toBe(3)
      expect(first.skipped).toBe(0)
      expect(first.linked).toBe(1)
      expect(first.contacts).toBeGreaterThan(0)
      expect(first.errors).toEqual([])

      expect(await mailMessageRowsFor(account.id)).toHaveLength(3)
      const folders = await mailFolderRowsFor(account.id)
      expect(folders.map((folder) => folder.path)).toEqual(["INBOX", "Sent"])
      expect(folders.find((folder) => folder.path === "INBOX")?.lastUid).toBe(3)
      expect(folders.find((folder) => folder.path === "Sent")?.lastUid).toBe(2)

      const conversations = await conversationsList(a.userId, { channel: "mail" })
      expect(conversations).toHaveLength(2)
      const threaded = conversations.find((row) => row.externalId === "subj:senior devops vacancy")!
      expect(threaded).toBeDefined()
      expect(threaded.vacancyId as string | null).toBe(vacancyId)
      expect(threaded.lastMessage).toBe("Спасибо, откликнулся.")

      const detail = await conversationGet(a.userId, threaded.id)
      expect(detail.messages.map((message) => message.direction)).toEqual(["in", "out"])
      expect(detail.messages.map((message) => message.externalId)).toEqual([
        "root@acme.dev",
        "reply@acme.dev"
      ])

      expect(await conversationVacanciesFor(threaded.id)).toEqual([
        expect.objectContaining({ vacancyId, kind: "primary", source: "mail" })
      ])

      expect(await conversationsList(b.userId)).toEqual([])
      expect((await conversationGetFailure(b.userId, threaded.id))._tag).toBe("NotFound")

      const synced = (await mailAccountRowsFor(a.userId)).find((row) => row.id === account.id)!
      expect(synced.status).toBe("ok")
      expect(synced.lastSyncAt).not.toBeNull()
      expect(synced.lastError).toBeNull()

      // A second pass finds no new UIDs.
      const second = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(second.processed).toBe(0)
      expect(second.inserted).toBe(0)

      // Rewinding the cursor re-reads everything and dedupes by RFC Message-ID.
      await resetMailFolderCursor(account.id)
      const third = await mailSyncNow(a.userId, account.id, { mailGateway: fake })
      expect(third.processed).toBe(3)
      expect(third.inserted).toBe(0)
      expect(third.skipped).toBe(3)
      expect(await mailMessageRowsFor(account.id)).toHaveLength(3)
      expect(await conversationRowsFor(a.userId)).toHaveLength(2)

      const updated = await mailAccountUpsert(a.userId, {
        id: account.id,
        label: "work-2",
        address: "me@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "me@acme.dev"
      })
      expect(updated.id).toBe(account.id)
      expect(updated.label).toBe("work-2")

      const invalid = await mailAccountUpsertFailure(a.userId, {
        label: "bad",
        address: "not-an-email",
        host: "imap.acme.dev",
        port: 993,
        username: "me"
      })
      expect(invalid._tag).toBe("InvalidInput")

      expect(await mailAccountRemove(b.userId, account.id)).toMatchObject({ deleted: false })
      expect(await mailAccountRemove(a.userId, account.id)).toMatchObject({
        id: account.id,
        deleted: true
      })
      expect(await accountSecretExists(account.id)).toBe(false)
      expect(await mailAccountsList(a.userId)).toEqual([])
    })

    test("telegram account CRUD and fake sync", async () => {
      const a = await seedTenant("src-tg-a")
      const b = await seedTenant("src-tg-b")
      const externalId = uniqueDigits()
      const vacancyId = await seedVacancyWithExternal(externalId, "Platform Engineer")

      const dialogs: TelegramDialog[] = [
        {
          id: "100",
          title: "Anna HR",
          username: "acme_hr",
          kind: "private",
          lastMessageAt: new Date("2026-11-01T12:00:00.000Z").toISOString(),
          lastMessage: "Пишите в телеграм",
          unreadCount: 2,
          readInboxMaxId: 1,
          readOutboxMaxId: null,
          archived: false
        },
        {
          id: "-200",
          title: "Acme channel",
          username: null,
          kind: "channel",
          lastMessageAt: null,
          lastMessage: "news",
          unreadCount: 5,
          readInboxMaxId: null,
          readOutboxMaxId: null,
          archived: false
        },
        {
          id: "300",
          title: "Acme bot",
          username: "acme_bot",
          kind: "private",
          lastMessageAt: null,
          lastMessage: "beep",
          unreadCount: 0,
          readInboxMaxId: null,
          readOutboxMaxId: null,
          archived: false
        }
      ]

      const fake = new FakeTelegramGateway({
        me: {
          id: "42",
          username: "my_tg",
          firstName: "Me",
          lastName: null,
          phone: "+79990001122"
        },
        dialogs,
        messages: {
          "100": [
            telegramMessage(
              "1",
              "in",
              `Здравствуйте! anna@acme.dev, @acme_hr, вакансия https://hh.ru/vacancy/${externalId}`
            ),
            telegramMessage("2", "out", "Спасибо, посмотрю.")
          ]
        }
      })
      fake.authorized = true

      const account = await telegramAccountUpsert(a.userId, {
        label: "hr",
        apiId: 123456,
        apiHash: "0123456789abcdef0123456789abcdef",
        phone: "+7 999 123-45-67"
      })
      expect(account.status).toBe("idle")
      expect(account.phoneMasked).toBe("+79***4567")
      expect((await telegramAccountsList(a.userId)).map((row) => row.id)).toEqual([account.id])
      expect(await telegramAccountsList(b.userId)).toEqual([])

      const invalid = await telegramAccountUpsertFailure(a.userId, {
        label: "bad",
        apiId: 0,
        apiHash: "x"
      })
      expect(invalid._tag).toBe("InvalidInput")

      const sync = await telegramSyncNow(a.userId, account.id, { telegramGateway: fake })
      expect(sync.processed).toBe(1)
      expect(sync.inserted).toBe(2)
      expect(sync.skipped).toBe(0)
      expect(sync.linked).toBe(1)
      expect(sync.contacts).toBeGreaterThan(0)
      expect(sync.errors).toEqual([])

      const conversations = await conversationsList(a.userId, { channel: "telegram" })
      expect(conversations).toHaveLength(1)
      expect(conversations[0]).toMatchObject({
        externalId: "100",
        title: "Anna HR",
        unreadCount: 2,
        vacancyId
      })
      const detail = await conversationGet(a.userId, conversations[0]!.id)
      expect(detail.messages).toHaveLength(2)
      expect(detail.messages[0]).toMatchObject({
        externalId: "1",
        direction: "in",
        kind: "text"
      })
      expect(detail.messages[0]!.readAt).not.toBeNull()
      expect(detail.messages[1]!.readAt).toBeNull()

      const contacts = await contactsList(a.userId, { source: "telegram" })
      expect(contacts.items.map((contact) => `${contact.kind}:${contact.value}`)).toContain(
        "telegram:@acme_hr"
      )
      expect(await conversationsList(b.userId)).toEqual([])

      const second = await telegramSyncNow(a.userId, account.id, { telegramGateway: fake })
      expect(second.inserted).toBe(0)
      expect(second.skipped).toBe(2)

      expect(await telegramAccountRemove(b.userId, account.id)).toMatchObject({ deleted: false })
      expect(await telegramAccountRemove(a.userId, account.id)).toMatchObject({
        id: account.id,
        deleted: true
      })
      expect(await telegramAccountsList(a.userId)).toEqual([])
    })

    test("telegram QR login stores the session and reports status", async () => {
      const tenant = await seedTenant("src-tg-qr")
      const fake = new FakeTelegramGateway({
        me: {
          id: "77",
          username: "qr_user",
          firstName: "Qr",
          lastName: null,
          phone: "+79990002233"
        },
        qrUrl: "tg://login?token=cXItZmFrZQ",
        qrExpiresAt: new Date("2026-11-02T13:00:00.000Z")
      })
      fake.authorized = false

      const account = await telegramAccountUpsert(tenant.userId, {
        label: "qr",
        apiId: 654321,
        apiHash: "abcdef0123456789abcdef0123456789"
      })

      const result = await runAsWithOptions(
        tenant.userId,
        { telegramGateway: fake },
        Effect.gen(function*() {
          const telegram = yield* TelegramService
          const qr = yield* telegram.loginQr(account.id)
          const status = yield* Effect.gen(function*() {
            for (;;) {
              const current = yield* telegram.loginStatus(account.id)
              if (current.status !== "pending" && current.status !== "idle") return current
              yield* Effect.sleep("20 millis")
            }
          }).pipe(Effect.timeoutOption("3 seconds"))
          return { qr, status }
        })
      )

      expect(result.qr.qrUrl).toBe("tg://login?token=cXItZmFrZQ")
      expect(result.qr.expiresAt).toBe("2026-11-02T13:00:00.000Z")
      expect(Option.isSome(result.status)).toBe(true)
      if (Option.isSome(result.status)) {
        expect(result.status.value.status).toBe("authorized")
      }
      expect(await readSession(account.id)).not.toBeNull()

      const row = (await telegramAccountRowsFor(tenant.userId))[0]!
      expect(row.status).toBe("ok")
      expect(row.tgUserId).toBe("77")
      expect(row.username).toBe("qr_user")
      expect(row.phoneMasked).toBe("+79***2233")
    })

    test("schedules dispatch source kinds and isolate failures", async () => {
      const tenant = await seedTenant("src-sched")
      const now = new Date("2026-11-02T14:00:00.000Z")

      const externalId = uniqueDigits()
      await seedVacancyWithExternal(externalId, "SRE")
      const fake = new FakeMailGateway({
        address: "sched@acme.dev",
        messages: [
          mailMessage({
            folder: "INBOX",
            uid: 1,
            rfcMessageId: "sched@acme.dev",
            from: [{ name: "HR", address: "hr@acme.dev" }],
            to: [{ name: "Me", address: "sched@acme.dev" }],
            subject: "SRE role",
            sentAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            receivedAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            text: `Вакансия https://hh.ru/vacancy/${externalId}`,
            snippet: "SRE role"
          })
        ]
      })
      const account = await mailAccountUpsert(tenant.userId, {
        label: "sched",
        address: "sched@acme.dev",
        host: "imap.acme.dev",
        port: 993,
        username: "sched@acme.dev",
        password: "secret"
      })
      const telegramFake = new FakeTelegramGateway({
        dialogs: [
          {
            id: "500",
            title: "Sched HR",
            username: "sched_hr",
            kind: "private",
            lastMessageAt: new Date("2026-11-02T09:00:00.000Z").toISOString(),
            lastMessage: "hello",
            unreadCount: 1,
            readInboxMaxId: null,
            readOutboxMaxId: null,
            archived: false
          }
        ],
        messages: { "500": [telegramMessage("1", "in", "Здравствуйте из телеграма")] }
      })
      telegramFake.authorized = true
      const telegramAccount = await telegramAccountUpsert(tenant.userId, {
        label: "sched-tg",
        apiId: 222222,
        apiHash: "fedcba9876543210fedcba9876543210"
      })

      const chatSchedule = await scheduleUpsert(tenant.userId, {
        kind: "hh_chat_sync",
        targetId: "global",
        intervalMinutes: 60
      })
      expect(chatSchedule.kind).toBe("hh_chat_sync")

      const mailSchedule = await scheduleUpsert(tenant.userId, {
        kind: "mail_sync",
        targetId: account.id,
        intervalMinutes: 30,
        options: { limit: 50, maxPages: 2 }
      })
      expect(mailSchedule).toMatchObject({
        kind: "mail_sync",
        targetId: account.id,
        options: { limit: 50, maxPages: 2 }
      })

      const hydrationCalls: Array<{
        limit?: number
        delayMs?: number
        proxyMode?: string
        onProgress?: (progress: Record<string, unknown>) => unknown
      }> = []
      const hydrationLayer = Layer.succeed(HydrationRunner, HydrationRunner.of({
        run: (_userId: string, options: { limit?: number; delayMs?: number; proxyMode?: string } = {}) =>
          Effect.sync(() => {
            hydrationCalls.push(options)
            return {
              processed: 1,
              target: 1,
              hydrated: 1,
              failed: 0,
              inserted: 1,
              updated: 0,
              skipped: 0,
              errors: [],
              proxyMode: "auto",
              proxy: "напрямую",
              proxySource: null,
              stoppedBy: null,
              rotations: 0
            } satisfies HydrationRunResult
          }),
        hydrateOne: (_userId: string, _id: string) => Effect.succeed(true),
        fetchByReference: (_userId: string, _reference: string) =>
          Effect.die("fetchByReference is not used by schedules")
      }))
      const hydrationSchedule = await scheduleUpsert(tenant.userId, {
        kind: "vacancy_hydration",
        targetId: "global",
        intervalMinutes: 120,
        options: { limit: 5, delayMs: 0 }
      })

      const telegramSchedule = await scheduleUpsert(tenant.userId, {
        kind: "telegram_sync",
        targetId: telegramAccount.id,
        intervalMinutes: 30
      })

      const past = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
      await setScheduleNextRun(chatSchedule.id, past(5))
      await setScheduleNextRun(mailSchedule.id, past(4))
      await setScheduleNextRun(hydrationSchedule.id, past(3))
      await setScheduleNextRun(telegramSchedule.id, past(2))

      const outcomes = await runDueSchedulesWithGateways(
        tenant.userId,
        {
          runner: recordingRunner([]),
          hydrationRunner: hydrationLayer,
          mailGateway: fake,
          telegramGateway: telegramFake
        },
        { now, limit: 10 }
      )

      expect(outcomes).toHaveLength(4)

      const chat = outcomes.find((row) => row.scheduleId === chatSchedule.id)!
      expect(chat.ok).toBe(false)
      expect(chat.error).toBe(
        "hh chat sync requires the browser harness; it is not implemented yet"
      )

      const mail = outcomes.find((row) => row.scheduleId === mailSchedule.id)!
      expect(mail).toMatchObject({ ok: true, error: null, kind: "mail_sync" })

      const hydration = outcomes.find((row) => row.scheduleId === hydrationSchedule.id)!
      expect(hydration).toMatchObject({ ok: true, error: null })
      expect(hydrationCalls).toEqual([
        { limit: 5, delayMs: 0, proxyMode: "auto", onProgress: expect.any(Function) }
      ])

      const telegram = outcomes.find((row) => row.scheduleId === telegramSchedule.id)!
      expect(telegram).toMatchObject({ ok: true, error: null, kind: "telegram_sync" })

      expect((await findScheduleRow(chatSchedule.id))?.lastError).toBe(chat.error)
      expect((await findScheduleRow(mailSchedule.id))?.lastError).toBeNull()
      expect((await findScheduleRow(telegramSchedule.id))?.lastError).toBeNull()
      expect(await conversationsList(tenant.userId, { channel: "mail" })).toHaveLength(1)
      expect(await conversationsList(tenant.userId, { channel: "telegram" })).toHaveLength(1)

      const invalidTarget = await scheduleUpsertFailure(tenant.userId, {
        kind: "mail_sync",
        targetId: "https://hh.ru/search/vacancy?text=x",
        intervalMinutes: 30
      })
      expect(invalidTarget._tag).toBe("InvalidInput")

      for (const schedule of [
        chatSchedule,
        mailSchedule,
        hydrationSchedule,
        telegramSchedule
      ]) {
        await scheduleRemove(tenant.userId, schedule.id)
      }
      await mailAccountRemove(tenant.userId, account.id)
      await telegramAccountRemove(tenant.userId, telegramAccount.id)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* 10. Blacklist: a soft filter and a label                                 */
  /* ------------------------------------------------------------------------ */

  describe("blacklist", () => {
    const tag = () => randomUUID().slice(0, 8)

    test("an app block hides vacancies and companies by default, labels them when included", async () => {
      const tenant = await seedTenant("blacklist-app")
      const suffix = tag()

      const blocked = await seedVacancyForEmployer({
        label: `blocked-${suffix}`,
        title: `DevOps blocked ${suffix}`,
        employerExternalId: `bl-emp-${suffix}`,
        employerName: `Blocklist Co ${suffix}`
      })
      const specific = await seedVacancyForEmployer({
        label: `specific-${suffix}`,
        title: `DevOps specific ${suffix}`,
        employerExternalId: `visible-emp-${suffix}`,
        employerName: `Visible Co ${suffix}`
      })
      const visible = await seedVacancyForEmployer({
        label: `visible-${suffix}`,
        title: `DevOps visible ${suffix}`,
        employerExternalId: `other-emp-${suffix}`,
        employerName: `Other Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `bl-emp-${suffix}`,
        name: `Blocklist Co ${suffix}`,
        reason: "not interested"
      })
      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "vacancy",
        externalId: specific.externalId,
        name: `DevOps specific ${suffix}`
      })

      const hidden = await corpusList(tenant.userId, { limit: 200 })
      const hiddenIds = hidden.items.map((item) => String(item.id))
      expect(hiddenIds).not.toContain(blocked.vacancyId)
      expect(hiddenIds).not.toContain(specific.vacancyId)
      expect(hiddenIds).toContain(visible.vacancyId)

      const shown = await corpusList(tenant.userId, {
        includeBlacklisted: true,
        limit: 200
      })
      const blockedRow = shown.items.find((item) => item.id === blocked.vacancyId)!
      expect(blockedRow.blacklisted).toBe(true)
      expect(blockedRow.blacklistLayers).toEqual(["app"])
      const specificRow = shown.items.find((item) => item.id === specific.vacancyId)!
      expect(specificRow.blacklistLayers).toEqual(["app"])
      const visibleRow = shown.items.find((item) => item.id === visible.vacancyId)!
      expect(visibleRow.blacklisted).toBe(false)
      expect(visibleRow.blacklistLayers).toEqual([])

      // The companies page toggle: same filter, same label.
      const companiesHidden = await employersList(tenant.userId, {
        query: `Blocklist Co ${suffix}`,
        limit: 20
      })
      expect(companiesHidden.total).toBe(0)
      const companiesShown = await employersList(tenant.userId, {
        query: `Blocklist Co ${suffix}`,
        includeBlacklisted: true,
        limit: 20
      })
      expect(companiesShown.total).toBe(1)
      expect(companiesShown.items[0]!.blacklisted).toBe(true)
      expect(companiesShown.items[0]!.blacklistLayers).toEqual(["app"])

      // The row stayed in the corpus; only visibility changed.
      expect((await hiddenTargetRowsFor(tenant.userId)).length).toBe(2)

      // Preset preview excludes app-blocked rows by default and can opt in.
      const previewFilter = {
        rules: [{ field: "title" as const, op: "contains" as const, value: suffix }]
      }
      const previewHidden = await presetPreview(tenant.userId, previewFilter)
      expect(previewHidden.count).toBe(1)
      expect(previewHidden.vacancies.map((item) => String(item.id))).toEqual([
        visible.vacancyId
      ])

      const previewShown = await presetPreview(tenant.userId, {
        ...previewFilter,
        includeBlacklisted: true
      })
      expect(previewShown.count).toBe(3)
      expect(previewShown.vacancies.find((item) => item.id === blocked.vacancyId)?.blacklisted)
        .toBe(true)
    })

    test("scope/account combinations are validated", async () => {
      const tenant = await seedTenant("blacklist-validate")

      const appWithAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "app",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(appWithAccount._tag).toBe("InvalidInput")

      const accountWithoutAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "hh_account",
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(accountWithoutAccount._tag).toBe("InvalidInput")

      const foreignAccount = await blacklistUpsertFailure(tenant.userId, {
        scope: "hh_account",
        hhAccountId: randomUUID(),
        targetType: "employer",
        externalId: `bad-${tag()}`
      })
      expect(foreignAccount._tag).toBe("NotFound")
    })

    test("an account block applies only to that account", async () => {
      const tenant = await seedTenant("blacklist-account")
      const second = await addAccount(tenant.userId, "blacklist-account-second")
      const suffix = tag()

      const target = await seedVacancyForEmployer({
        label: `account-${suffix}`,
        title: `DevOps account ${suffix}`,
        employerExternalId: `account-emp-${suffix}`,
        employerName: `Account Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `account-emp-${suffix}`,
        name: `Account Co ${suffix}`
      })

      const first = await corpusList(tenant.userId, {
        hhAccountId: tenant.accountId,
        limit: 200
      })
      expect(first.items.map((item) => item.id)).not.toContain(target.vacancyId)

      const other = await corpusList(tenant.userId, {
        hhAccountId: second,
        limit: 200
      })
      expect(other.items.map((item) => String(item.id))).toContain(target.vacancyId)

      // Without an explicit account only the app layer applies.
      const noAccount = await corpusList(tenant.userId, { limit: 200 })
      expect(noAccount.items.map((item) => String(item.id))).toContain(target.vacancyId)

      const shown = await corpusList(tenant.userId, {
        hhAccountId: tenant.accountId,
        includeBlacklisted: true,
        limit: 200
      })
      const row = shown.items.find((item) => item.id === target.vacancyId)!
      expect(row.blacklisted).toBe(true)
      expect(row.blacklistLayers).toEqual(["hh_account"])

      const listing = await blacklistList(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId
      })
      expect(listing.total).toBe(1)
    })

    test("the hidden rule picks the layer and the account that hid a company", async () => {
      const tenant = await seedTenant("blacklist-hidden-rule")
      const second = await addAccount(tenant.userId, "blacklist-hidden-rule-second")
      const suffix = tag()
      const make = (name: string) =>
        seedVacancyForEmployer({
          label: `${name}-${suffix}`,
          title: `Hiddenrule ${name} ${suffix}`,
          employerExternalId: `hr-${name}-${suffix}`,
          employerName: `Hiddenrule ${name} Co ${suffix}`
        })
      const byApp = await make("app")
      const byList = await make("list")
      const byHh = await make("hh")
      const bySecond = await make("second")
      const clean = await make("clean")

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `hr-app-${suffix}`
      })
      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: tenant.accountId,
        targetType: "employer",
        externalId: `hr-list-${suffix}`
      })
      await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [{ targetType: "employer", externalId: `hr-hh-${suffix}` }]
      })
      await blacklistUpsert(tenant.userId, {
        scope: "hh_account",
        hhAccountId: second,
        targetType: "employer",
        externalId: `hr-second-${suffix}`
      })

      const matching = async (op: "in" | "not_in", value: ReadonlyArray<string>) => {
        const preview = await presetPreview(tenant.userId, {
          includeBlacklisted: true,
          rules: [
            { field: "title", op: "contains", value: `Hiddenrule` },
            { field: "title", op: "contains", value: suffix },
            { field: "hidden", op, value }
          ]
        })
        return preview.vacancies.map((item) => String(item.id)).sort()
      }
      const ids = (...rows: ReadonlyArray<{ readonly vacancyId: string }>) =>
        rows.map((row) => String(row.vacancyId)).sort()

      expect(await matching("in", ["app"])).toEqual(ids(byApp))
      expect(await matching("in", ["accounts"])).toEqual(ids(byList, byHh, bySecond))
      expect(await matching("in", ["hh"])).toEqual(ids(byHh))
      expect(await matching("in", [`account:${tenant.accountId}`])).toEqual(ids(byList, byHh))
      expect(await matching("in", [`hh:${second}`])).toEqual([])
      expect(await matching("in", ["any"])).toEqual(ids(byApp, byList, byHh, bySecond))
      expect(await matching("not_in", ["accounts"])).toEqual(ids(byApp, clean))
    })

    test("hh-native import is idempotent, updates names and never deletes absent entries", async () => {
      const tenant = await seedTenant("blacklist-native")
      const suffix = tag()
      const employerExternalId = `native-emp-${suffix}`
      const vacancyExternalId = `native-vac-${suffix}`

      const first = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [
          { targetType: "employer", externalId: employerExternalId, name: "Native Co" },
          { targetType: "vacancy", externalId: vacancyExternalId, name: "Native vacancy" }
        ]
      })
      expect(first).toEqual({ imported: 2, updated: 0, skipped: 0 })

      const rows = await hiddenTargetRowsFor(tenant.userId)
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.scope)).toEqual(["hh_native", "hh_native"])
      expect(rows.map((row) => row.source)).toEqual(["hh_hidden", "hh_hidden"])
      const firstSeen = rows.find((row) => row.externalId === employerExternalId)!.lastSeenAt!

      const second = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [
          {
            targetType: "employer",
            externalId: employerExternalId,
            name: "Native Co renamed"
          },
          { targetType: "vacancy", externalId: vacancyExternalId, name: "Native vacancy" }
        ]
      })
      expect(second).toEqual({ imported: 0, updated: 2, skipped: 0 })

      const afterSecond = await hiddenTargetRowsFor(tenant.userId)
      expect(afterSecond).toHaveLength(2)
      const renamed = afterSecond.find((row) => row.externalId === employerExternalId)!
      expect(renamed.name).toBe("Native Co renamed")
      expect(renamed.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(firstSeen.getTime())

      // Only the listed entry is touched; the other native row is not deleted.
      const third = await blacklistImportHh(tenant.userId, {
        hhAccountId: tenant.accountId,
        entries: [{ targetType: "employer", externalId: employerExternalId }]
      })
      expect(third).toEqual({ imported: 0, updated: 1, skipped: 0 })
      expect(await hiddenTargetRowsFor(tenant.userId)).toHaveLength(2)
    })

    test("a company block marks a vacancy ingested later", async () => {
      const tenant = await seedTenant("blacklist-new")
      const suffix = tag()
      const employerExternalId = `new-emp-${suffix}`
      const externalId = `new-vac-${suffix}`

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: employerExternalId,
        name: `New Co ${suffix}`
      })

      const ingested = await corpusIngest(tenant.userId, [
        {
          externalId,
          canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
          title: `DevOps new ${suffix}`,
          employer: { externalId: employerExternalId, name: `New Co ${suffix}` },
          salary: { from: 300_000, to: 400_000, currency: "RUB" },
          workFormats: ["remote"],
          seniority: "senior"
        } satisfies VacancyDraft
      ])
      expect(ingested.inserted).toBe(1)
      const vacancyId = ingested.items[0]!.id

      const hidden = await corpusList(tenant.userId, { limit: 200 })
      expect(hidden.items.map((item) => item.id)).not.toContain(vacancyId)

      const shown = await corpusList(tenant.userId, {
        includeBlacklisted: true,
        limit: 200
      })
      const row = shown.items.find((item) => item.id === vacancyId)!
      expect(row.blacklisted).toBe(true)
      expect(row.blacklistLayers).toEqual(["app"])
    })

    test("evaluate blocks with blocked_blacklist by default and proceeds when included", async () => {
      const tenant = await seedTenant("blacklist-evaluate")
      const suffix = tag()

      const target = await seedVacancyForEmployer({
        label: `evaluate-${suffix}`,
        title: `DevOps engineer ${suffix}`,
        employerExternalId: `evaluate-emp-${suffix}`,
        employerName: `Evaluate Co ${suffix}`
      })

      await blacklistUpsert(tenant.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `evaluate-emp-${suffix}`,
        name: `Evaluate Co ${suffix}`
      })

      const blocked = await evaluateVacancy(tenant.userId, {
        vacancyId: target.vacancyId,
        fit: 80
      })
      expect(blocked.verdict).toBe("skip")
      expect(blocked.reasons[0]!.code).toBe("blocked_blacklist")
      expect(blocked.reasons[0]!.detail).toBe("employer:app")

      const included = await evaluateVacancy(tenant.userId, {
        vacancyId: target.vacancyId,
        fit: 80,
        includeBlacklisted: true
      })
      expect(included.verdict).not.toBe("skip")
      expect(included.reasons.map((reason) => reason.code)).not.toContain("blocked_blacklist")
    })

    test("RLS keeps one user's blacklist invisible to another", async () => {
      const a = await seedTenant("blacklist-rls-a")
      const b = await seedTenant("blacklist-rls-b")

      await blacklistUpsert(a.userId, {
        scope: "app",
        targetType: "employer",
        externalId: `rls-emp-${tag()}`
      })

      // `BlacklistRepository.list` has no explicit user predicate; the empty
      // result for B is row-level security doing its job.
      expect((await blacklistList(b.userId)).items).toHaveLength(0)
      expect((await blacklistList(a.userId)).total).toBe(1)
    })
  })
}
