import type { JobKind, JobStage } from "@otbor/contract"
import { asc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import {
  accountLease,
  application,
  harnessJob,
  searchQuery,
  searchRun,
  vacancySearchHit
} from "../../../src/db/tables.ts"
import * as HarnessRepository from "../../../src/repositories/HarnessRepository.ts"
import * as QueueRepository from "../../../src/repositories/QueueRepository.ts"
import { ApplicationService } from "../../../src/services/ApplicationService.ts"
import { recoverExpiredLeases } from "../../../src/services/recovery.ts"
import { runAs } from "./layers.ts"
import { ownerTx } from "./seeds.ts"

export const findJob = async (jobId: string) =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.findById(tx, jobId))
  )

/** The account a job is pinned to; `HarnessJob` itself does not expose it. */
export const jobAccountId = async (jobId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({ hhAccountId: harnessJob.hhAccountId })
        .from(harnessJob)
        .where(eq(harnessJob.id, jobId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.hhAccountId ?? null))
    )
  )

export const countJobs = async (applicationId: string, stage: JobStage) =>
  runAs(
    "owner",
    ownerTx((tx) => QueueRepository.countFor(tx, applicationId, stage))
  )

/** Form reads queued for a vacancy: they have no application, only a vacancy in the payload. */
export const formReadJobsOf = async (vacancyId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .execute(
          sql`select id, status, payload, result from harness_jobs where stage = 'form_read' and payload->>'vacancyId' = ${vacancyId} order by created_at`
        )
        .pipe(Effect.map((result) => result.rows as ReadonlyArray<Record<string, any>>))
    )
  )

/** Pretends the form was last read `hours` ago. */
export const ageVacancyForm = async (vacancyId: string, hours: number) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(
        sql`update vacancy_form_state set checked_at = now() - make_interval(hours => ${hours}) where vacancy_id = ${vacancyId}`
      )
    )
  )

export const vacancyFormState = async (userId: string, vacancyId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.formGet(vacancyId)
    })
  )

export const findApplication = async (applicationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: application.id,
          state: application.state,
          blockedReason: application.blockedReason,
          submittedAt: application.submittedAt
        })
        .from(application)
        .where(eq(application.id, applicationId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const accountsFor = async (harnessId: string) =>
  runAs(
    "owner",
    ownerTx((tx) => HarnessRepository.accountsFor(tx, harnessId))
  )

export const harnessAccountRows = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .execute(
          sql`select harness_id, user_id from harness_account where hh_account_id = ${accountId}`
        )
        .pipe(Effect.map((result) => result.rows))
    )
  )

/** Expires a job lease without waiting, so recovery can be tested quickly. */
export const expireJobLease = async (jobId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(
        sql`update harness_jobs set lease_until = now() - interval '1 minute' where id = ${jobId}`
      )
    )
  )
}

export const recoverExpiredJobs = async () =>
  runAs(
    "owner",
    ownerTx((tx) =>
      recoverExpiredLeases(tx).pipe(Effect.map((jobs) => jobs.map((job) => job.id)))
    )
  )

export const makeJobRunnable = async (jobId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(sql`update harness_jobs set run_at = now() where id = ${jobId}`)
    )
  )
}

export const expireAccountLease = async (accountId: string) => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.execute(
        sql`update account_lease set expires_at = now() - interval '1 minute' where hh_account_id = ${accountId}`
      )
    )
  )
}

export const findAccountLease = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(accountLease)
        .where(eq(accountLease.hhAccountId, accountId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const claimAsHolder = async (input: {
  readonly holder: string
  readonly accounts: ReadonlyArray<string>
  readonly kinds?: ReadonlyArray<JobKind>
  readonly leaseSeconds?: number
  readonly browserConcurrency?: number
  readonly actingConcurrency?: number
  /** Темп отправок в секундах; по умолчанию 0, чтобы старые тесты не ждали. */
  readonly submitIntervalSeconds?: number
  /** Часовой лимит отправок, когда у владельца нет строки настроек; по умолчанию без лимита. */
  readonly submitHourlyLimit?: number | null
}) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      QueueRepository.claim(tx, {
        holder: input.holder,
        accounts: input.accounts,
        kinds: input.kinds ?? ["browser"],
        leaseSeconds: input.leaseSeconds,
        submitIntervalSeconds: input.submitIntervalSeconds ?? 0,
        formReadIntervalSeconds: 0,
        formReadConcurrency: 12,
        submitHourlyLimit: input.submitHourlyLimit ?? null,
        ...(input.browserConcurrency === undefined ? {} : { browserConcurrency: input.browserConcurrency }),
        ...(input.actingConcurrency === undefined ? {} : { actingConcurrency: input.actingConcurrency })
      })
    )
  )

export const jobRowsForApplication = async (applicationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: harnessJob.id,
          stage: harnessJob.stage,
          status: harnessJob.status,
          runAt: harnessJob.runAt
        })
        .from(harnessJob)
        .where(eq(harnessJob.applicationId, applicationId))
    )
  )

export const findSearchQuery = async (normalizedUrl: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: searchQuery.id,
          url: searchQuery.url,
          normalizedUrl: searchQuery.normalizedUrl,
          title: searchQuery.title,
          textQuery: searchQuery.textQuery
        })
        .from(searchQuery)
        .where(eq(searchQuery.normalizedUrl, normalizedUrl))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null))
    )
  )

export const searchRunRowsFor = async (queryId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: searchRun.id,
          queryId: searchRun.queryId,
          status: searchRun.status,
          nextPage: searchRun.nextPage,
          pagesDone: searchRun.pagesDone,
          found: searchRun.found,
          error: searchRun.error,
          finishedAt: searchRun.finishedAt
        })
        .from(searchRun)
        .where(eq(searchRun.queryId, queryId))
        .orderBy(asc(searchRun.id))
    )
  )

export const searchHitsFor = async (queryId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          queryId: vacancySearchHit.queryId,
          vacancyId: vacancySearchHit.vacancyId,
          position: vacancySearchHit.position
        })
        .from(vacancySearchHit)
        .where(eq(vacancySearchHit.queryId, queryId))
        .orderBy(asc(vacancySearchHit.position), asc(vacancySearchHit.vacancyId))
    )
  )
