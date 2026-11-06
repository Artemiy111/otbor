import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import { application, employer, vacancy } from "../../../src/db/tables.ts"
import { ApplicationService } from "../../../src/services/ApplicationService.ts"
import { NegotiationsSync } from "../../../src/services/NegotiationsSync.ts"
import { ResumeSync } from "../../../src/services/ResumeSync.ts"
import { formReadJob, inferenceJob } from "../../../src/services/jobs.ts"
import { runAs, runAsFailure } from "./layers.ts"
import { ownerTx, seedVacancySkill, unique } from "./seeds.ts"

export const applicationApprove = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.approve(id)
    })
  )

export const applicationApproveFailure = async (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.approve(id)
    })
  )

export const applicationRetry = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.retry(id)
    })
  )

export const applicationSetKit = async (
  userId: string,
  input: Parameters<ApplicationService["Service"]["setKit"]>[0]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.setKit(input)
    })
  )

export const applicationGet = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const applications = yield* ApplicationService
      return yield* applications.get(id)
    })
  )

/** An inference job through the real `inferenceJob`; returns its stored payload. */
export const enqueueInferencePayload = async (
  userId: string,
  accountId: string,
  payload: Parameters<typeof inferenceJob>[1]["payload"]
) =>
  runAs(
    userId,
    ownerTx((tx) =>
      inferenceJob(tx, { userId, hhAccountId: accountId, payload, idempotencyKey: `test:${Math.random()}` })
    )
  ).then((job) => job.payload as Record<string, unknown>)

/** A form read for a vacancy, through the real `formReadJob`. */
export const enqueuePrepareJob = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly applicationId?: string
  readonly vacancyId: string
  readonly externalId: string
  readonly sequence?: number
}) =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      formReadJob(tx, {
        userId: input.userId,
        hhAccountId: input.accountId,
        vacancyId: input.vacancyId,
        canonicalUrl: `https://hh.ru/vacancy/${input.externalId}`,
        externalId: input.externalId,
        sessionProfile: null,
        priority: 0
      })
    )
  )

export const vacancyExternalId = async (vacancyId: string): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({ externalId: vacancy.externalId })
        .from(vacancy)
        .where(eq(vacancy.id, vacancyId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]!.externalId))
    )
  )

export const jobsOf = async (applicationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .execute(
          sql`select id, stage, status, payload, result, idempotency_key from harness_jobs where application_id = ${applicationId} order by created_at`
        )
        .pipe(Effect.map((result) => result.rows as ReadonlyArray<Record<string, any>>))
    )
  )

export const resumeSyncRun = async (userId: string, accountId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const sync = yield* ResumeSync
      return yield* sync.run(accountId)
    })
  )

export const resumeSyncStatus = async (userId: string, accountId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const sync = yield* ResumeSync
      return yield* sync.status(accountId)
    })
  )

export const negotiationsRun = async (userId: string, accountId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const sync = yield* NegotiationsSync
      return yield* sync.run(accountId)
    })
  )

export const negotiationsStatus = async (userId: string, accountId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const sync = yield* NegotiationsSync
      return yield* sync.status(accountId)
    })
  )

export const negotiationsRunFailure = async (userId: string, accountId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const sync = yield* NegotiationsSync
      return yield* Effect.flip(sync.run(accountId))
    })
  )

/** Applications of an account with the sync columns, as the owner sees them. */
export const applicationRowsFor = async (accountId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select({
          id: application.id,
          vacancyId: application.vacancyId,
          state: application.state,
          origin: application.origin,
          hhStatus: application.hhStatus,
          hhRespondedAt: application.hhRespondedAt,
          submittedAt: application.submittedAt
        })
        .from(application)
        .where(eq(application.hhAccountId, accountId))
    )
  )

/** An employer with optional hh rating and review count (company-size proxies). */
export const seedEmployerStats = async (
  externalId: string,
  name: string,
  stats: { readonly rating?: number; readonly reviewsCount?: number } = {}
): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .insert(employer)
        .values({
          source: "hh",
          externalId: unique(externalId),
          name,
          rating: stats.rating ?? null,
          reviewsCount: stats.reviewsCount ?? null
        })
        .returning({ id: employer.id })
        .pipe(Effect.map((rows) => rows[0]!.id))
    )
  )

/** A vacancy with the columns ad-hoc search filters on. */
export const seedSearchVacancy = async (input: {
  readonly label: string
  readonly title: string
  readonly employerId?: string
  readonly seniority?: string
  readonly experienceCode?: string
  readonly salaryFrom?: number
  readonly salaryTo?: number
  readonly salaryCurrency?: string
  readonly areaId?: number
  readonly publishedDaysAgo?: number
  readonly archived?: boolean
  readonly skills?: ReadonlyArray<string>
}): Promise<string> => {
  const externalId = unique(`v-${input.label}`)
  const id = await runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(vacancy)
          .values({
            source: "hh",
            externalId,
            canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
            title: input.title,
            employerId: input.employerId ?? null,
            seniority: input.seniority ?? "unknown",
            experienceCode: input.experienceCode ?? null,
            salaryFrom: input.salaryFrom ?? null,
            salaryTo: input.salaryTo ?? null,
            salaryCurrency: input.salaryCurrency ?? null,
            areaId: input.areaId ?? null,
            publishedAt: new Date(Date.now() - (input.publishedDaysAgo ?? 30) * 86_400_000),
            archived: input.archived ?? false,
            workFormats: [],
            contentHash: randomUUID()
          })
          .returning({ id: vacancy.id })
        return row!.id
      })
    )
  )
  for (const [position, term] of (input.skills ?? []).entries()) {
    await seedVacancySkill(id, term, position)
  }
  return id
}
