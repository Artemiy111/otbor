/**
 * The negotiations sync against a real Postgres: a browser job delivers pages,
 * the cloud parses them and imports applications made by hand on hh.ru. No
 * hh.ru: pages are built from the synthetic shapes of packages/hh.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { HarnessExit } from "@otbor/contract"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const listHtml = (topics: ReadonlyArray<Record<string, unknown>>, pages?: number) =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({
    applicantNegotiations: { ...(pages === undefined ? {} : { paging: { pages } }), topicList: topics }
  })}</template>`

const emptyList = listHtml([])

const syncExit = (...pages: ReadonlyArray<string>): HarnessExit => ({
  tag: "reconciled",
  artifacts: {
    pages: pages.map((html, index) => ({
      url: `https://hh.ru/applicant/negotiations?page=${index}`,
      html
    }))
  }
})

if (!enabled || serverUrl === null) {
  test("negotiations-sync integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("negotiations sync", () => {
    beforeAll(async () => {
      await support.createTestDatabase(base)
      await support.migrateTestDatabase(base)
      process.env.DATABASE_URL = support.testDatabaseUrl(base)
    }, 120_000)

    afterAll(async () => {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      await support.dropTestDatabase(base)
    }, 60_000)

    const setup = async (label: string) => {
      const tenant = await support.seedTenant(label)
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const lease = () =>
        support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      /** Lease the pending sync job and complete it with the given exit. */
      const finish = async (exit: HarnessExit) => {
        const leased = await lease()
        expect(leased.job?.stage).toBe("negotiations_sync")
        return support.completeJob(tenant.userId, {
          harnessId: harness.id,
          token: harness.token!,
          jobId: leased.job!.id,
          leaseId: leased.job!.leaseId!,
          epoch: leased.job!.leaseEpoch,
          exit
        })
      }
      return { tenant, harness, lease, finish }
    }

    test("run only enqueues, and a second run while one is waiting returns the same job", async () => {
      const ctx = await setup("sync-enqueue")
      const first = await support.negotiationsRun(ctx.tenant.userId, ctx.tenant.accountId)
      expect(first.status).toBe("pending")
      const second = await support.negotiationsRun(ctx.tenant.userId, ctx.tenant.accountId)
      expect(second.jobId).toBe(first.jobId)
      expect((await support.applicationRowsFor(ctx.tenant.accountId)).length).toBe(0)
    })

    test("an unknown account is NotFound, another user's account too", async () => {
      const a = await support.seedTenant("sync-nf-a")
      const b = await support.seedTenant("sync-nf-b")
      const failure = await support.negotiationsRunFailure(a.userId, b.accountId)
      expect(failure._tag).toBe("NotFound")
    })

    test("imports hand-made applications; otbor rows are never touched; reruns are idempotent", async () => {
      const ctx = await setup("sync-import")
      const { userId, accountId } = ctx.tenant

      const known = await support.seedVacancyWithExternal("9100001", "Known vacancy")
      const own = await support.seedVacancyWithExternal("9100002", "Own vacancy")
      const ownApplication = await support.seedApplication({
        userId,
        accountId,
        vacancyId: own,
        state: "queued"
      })

      const topics = [
        { vacancyId: 9100001, lastState: "RESPONSE", lastModified: "2026-10-01T10:00:00Z" },
        { vacancyId: 9100002, lastState: "INVITATION" },
        { vacancyId: 9100003, lastState: "DISCARD" },
        { vacancyId: 9100004, lastState: "VIEWED", vacancyName: "Not in the corpus" }
      ]
      const page = listHtml(topics)

      await support.negotiationsRun(userId, accountId)
      const done = await ctx.finish(syncExit(page, emptyList))
      expect(done.status).toBe("done")

      const status = await support.negotiationsStatus(userId, accountId)
      expect(status.status).toBe("done")
      expect(status.counts).toEqual({
        pages: 2,
        topics: 4,
        imported: 1,
        updated: 0,
        unchanged: 1,
        unknownVacancy: 2,
        unknownVacancyIds: ["9100003", "9100004"],
        complete: true
      })

      const rows = await support.applicationRowsFor(accountId)
      expect(rows).toHaveLength(2)
      const importedKnown = rows.find((row) => row.vacancyId === known)!
      expect(importedKnown).toMatchObject({ state: "submitted", origin: "imported", hhStatus: "RESPONSE" })
      expect(importedKnown.hhRespondedAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z")
      // Imported rows are not otbor submits.
      expect(importedKnown.submittedAt).toBeNull()
      // The application otbor made is neither overwritten nor downgraded.
      expect(rows.find((row) => row.id === ownApplication)).toMatchObject({
        state: "queued",
        origin: "otbor",
        hhStatus: null
      })

      // Same evidence again: nothing changes.
      await support.negotiationsRun(userId, accountId)
      await ctx.finish(syncExit(page, emptyList))
      const again = await support.negotiationsStatus(userId, accountId)
      expect(again.counts).toMatchObject({ imported: 0, updated: 0, unchanged: 2, unknownVacancy: 2 })
      expect(await support.applicationRowsFor(accountId)).toHaveLength(2)

      // hh moved a negotiation on: the imported row follows, the otbor row still does not.
      await support.negotiationsRun(userId, accountId)
      await ctx.finish(
        syncExit(
          listHtml([
            { vacancyId: 9100001, lastState: "INVITATION", lastModified: "2026-10-05T10:00:00Z" },
            { vacancyId: 9100002, lastState: "DISCARD" }
          ])
        )
      )
      const moved = await support.negotiationsStatus(userId, accountId)
      expect(moved.counts).toMatchObject({ imported: 0, updated: 1, unchanged: 1, complete: false })
      const after = await support.applicationRowsFor(accountId)
      expect(after.find((row) => row.vacancyId === known)).toMatchObject({ hhStatus: "INVITATION" })
      expect(after.find((row) => row.id === ownApplication)).toMatchObject({ origin: "otbor", state: "queued" })
    })

    test("imported applications count as already applied and can never be applied to again", async () => {
      const ctx = await setup("sync-dedupe")
      const { userId, accountId } = ctx.tenant
      const vacancyId = await support.seedVacancyWithExternal("9200001", "Imported vacancy")

      await support.negotiationsRun(userId, accountId)
      await ctx.finish(syncExit(listHtml([{ vacancyId: 9200001, lastState: "RESPONSE" }]), emptyList))
      const [row] = await support.applicationRowsFor(accountId)
      expect(row).toMatchObject({ origin: "imported", state: "submitted" })

      const decision = await support.evaluateVacancy(userId, { vacancyId, hhAccountId: accountId, fit: 90 })
      expect(decision.verdict).toBe("skip")
      expect(decision.reasons.map((reason) => reason.code)).toContain("blocked_applied")

      const failure = await support.applicationApproveFailure(userId, row!.id)
      expect(failure).toMatchObject({ _tag: "Conflict" })
      expect(await support.countJobs(row!.id, "prepare")).toBe(0)
      expect(await support.countJobs(row!.id, "submit")).toBe(0)
    })

    test("an unreadable result is retried, a login page needs a human, nothing is imported", async () => {
      const ctx = await setup("sync-failures")
      const { userId, accountId } = ctx.tenant

      await support.negotiationsRun(userId, accountId)
      const retry = await ctx.finish(syncExit("<html>oops</html>"))
      expect(retry.status).toBe("pending")

      // Retry is scheduled in the future; make it runnable again.
      const pending = await support.negotiationsStatus(userId, accountId)
      await support.makeJobRunnable(pending.jobId!)
      const human = await ctx.finish({ tag: "session_expired" })
      expect(human.status).toBe("needs_human")
      expect((await support.negotiationsStatus(userId, accountId)).status).toBe("needs_human")
      expect(await support.applicationRowsFor(accountId)).toHaveLength(0)
    })
  })
}
