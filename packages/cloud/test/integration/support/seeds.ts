import type { JobKind, JobStage, KitRecord } from "@otbor/contract"
import { normalizeTerm } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import { Database, type DatabaseError, type Executor } from "../../../src/db/Database.ts"
import {
  application,
  employer,
  hhAccount,
  keyword,
  keywordAlias,
  preset,
  resume,
  users,
  vacancy,
  vacancyKeyword,
  vacancySkill
} from "../../../src/db/tables.ts"
import * as ApplicationRepository from "../../../src/repositories/ApplicationRepository.ts"
import * as QueueRepository from "../../../src/repositories/QueueRepository.ts"
import { submitJob } from "../../../src/services/jobs.ts"
import { runAs } from "./layers.ts"

export const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`

export const ownerTx = <A, E>(
  run: (tx: Executor) => Effect.Effect<A, E, never>
): Effect.Effect<A, E | DatabaseError, Database> =>
  Effect.gen(function*() {
    const database = yield* Database
    return yield* database.asOwner((tx) => run(tx))
  })

export interface Tenant {
  readonly userId: string
  readonly accountId: string
}

/** A user and one hh account, inserted as the owner so setup never fights RLS. */
export const seedTenant = async (label: string): Promise<Tenant> => {
  const userId = unique(`it-${label}`)
  const accountId = await runAs(
    userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        yield* tx.insert(users).values({ id: userId, name: label, email: `${userId}@test.local` })
        const [account] = yield* tx.insert(hhAccount).values({ userId, label }).returning()
        return account!.id
      })
    )
  )
  return { userId, accountId }
}

export const addAccount = async (userId: string, label: string): Promise<string> => {
  const accountId = await runAs(
    userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [account] = yield* tx.insert(hhAccount).values({ userId, label }).returning()
        return account!.id
      })
    )
  )
  return accountId
}

/** Flips the user's default account without a service in between. */
export const setDefaultAccount = async (userId: string, accountId: string): Promise<void> => {
  await runAs(
    userId,
    ownerTx((tx) =>
      tx.execute(
        sql`update hh_account set is_default = (id = ${accountId}) where user_id = ${userId}`
      )
    )
  )
}

export const seedVacancyTitled = async (
  label: string,
  title: string,
  options: {
    readonly archived?: boolean
    readonly salaryFrom?: number
    readonly salaryCurrency?: string
    readonly seniority?: string
    readonly descriptionText?: string
    readonly workFormats?: ReadonlyArray<string>
  } = {}
): Promise<string> => {
  const externalId = unique(`v-${label}`)
  return runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(vacancy)
          .values({
            source: "hh",
            externalId,
            canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
            title,
            archived: options.archived ?? false,
            salaryFrom: options.salaryFrom ?? null,
            ...(options.salaryCurrency === undefined ? {} : { salaryCurrency: options.salaryCurrency }),
            ...(options.seniority === undefined ? {} : { seniority: options.seniority }),
            descriptionText: options.descriptionText ?? null,
            workFormats: options.workFormats ?? [],
            contentHash: randomUUID()
          })
          .returning()
        return row!.id
      })
    )
  )
}

export const seedVacancy = async (label: string): Promise<string> =>
  seedVacancyTitled(label, `Integration vacancy ${label}`)

/** A vacancy with a caller-chosen hh external id, for link assertions. */
export const seedVacancyWithExternal = async (
  externalId: string,
  title: string
): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(vacancy)
          .values({
            source: "hh",
            externalId,
            canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
            title,
            descriptionText: null,
            workFormats: [],
            contentHash: randomUUID()
          })
          .returning()
        return row!.id
      })
    )
  )

export const seedEmployer = async (externalId: string, name: string): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .insert(employer)
        .values({ source: "hh", externalId, name })
        .onConflictDoUpdate({
          target: [employer.source, employer.externalId],
          set: { name: sql`excluded.name` }
        })
        .returning({ id: employer.id })
        .pipe(Effect.map((rows) => rows[0]!.id))
    )
  )

/** A vacancy attached to a named company, so employer-level layers can match. */
export const seedVacancyForEmployer = async (input: {
  readonly label: string
  readonly title: string
  readonly employerExternalId: string
  readonly employerName: string
}): Promise<{ readonly vacancyId: string; readonly employerId: string; readonly externalId: string }> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [employerRow] = yield* tx
          .insert(employer)
          .values({
            source: "hh",
            externalId: input.employerExternalId,
            name: input.employerName
          })
          .onConflictDoUpdate({
            target: [employer.source, employer.externalId],
            set: { name: sql`excluded.name` }
          })
          .returning({ id: employer.id })

        const externalId = unique(`v-${input.label}`)
        const [row] = yield* tx
          .insert(vacancy)
          .values({
            source: "hh",
            externalId,
            canonicalUrl: `https://hh.ru/vacancy/${externalId}`,
            title: input.title,
            employerId: employerRow!.id,
            salaryFrom: 300_000,
            salaryTo: 400_000,
            salaryCurrency: "RUB",
            workFormats: ["remote"],
            seniority: "senior",
            descriptionText: "Kubernetes, Terraform, Linux",
            contentHash: randomUUID()
          })
          .returning({ id: vacancy.id })

        return {
          vacancyId: row!.id,
          employerId: employerRow!.id,
          externalId
        }
      })
    )
  )

export const seedVacancySkill = async (
  vacancyId: string,
  term: string,
  position = 0
): Promise<void> => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.insert(vacancySkill).values({
        vacancyId,
        term,
        normalizedTerm: normalizeTerm(term),
        position
      })
    )
  )
}
export const seedKeyword = async (term: string): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(keyword)
          .values({ term, normalizedTerm: normalizeTerm(term) })
          .returning({ id: keyword.id })
        return row!.id
      })
    )
  )

export const seedKeywordAlias = async (keywordId: string, alias: string): Promise<void> => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.insert(keywordAlias).values({
        keywordId,
        alias,
        normalizedAlias: normalizeTerm(alias)
      })
    )
  )
}

export const seedVacancyKeyword = async (input: {
  readonly vacancyId: string
  readonly keywordId: string
  readonly matchedForm: string
  readonly inTitle?: boolean
  readonly inBody?: boolean
  readonly inSkills?: boolean
}): Promise<void> => {
  await runAs(
    "owner",
    ownerTx((tx) =>
      tx.insert(vacancyKeyword).values({
        vacancyId: input.vacancyId,
        keywordId: input.keywordId,
        matchedForm: normalizeTerm(input.matchedForm),
        inTitle: input.inTitle ?? false,
        titleCount: input.inTitle === true ? 1 : 0,
        inBody: input.inBody ?? false,
        bodyCount: input.inBody === true ? 1 : 0,
        inSkills: input.inSkills ?? false
      })
    )
  )
}

export const seedPreset = async (
  userId: string,
  input: {
    readonly kind?: "explore" | "apply"
    readonly title: string
    readonly filter?: {
      readonly text?: string
      readonly rules?: ReadonlyArray<Record<string, unknown>>
      /** Legacy keys of old stored filters (`gate`, ...) may be seeded on purpose. */
      readonly [legacy: string]: unknown
      readonly keywordIds?: ReadonlyArray<string>
      readonly includeBlacklisted?: boolean
    }
  }
): Promise<string> => {
  const [row] = await runAs(
    userId,
    ownerTx((tx) =>
      tx
        .insert(preset)
        .values({
          userId,
          kind: input.kind ?? "explore",
          title: input.title,
          filter: (input.filter ?? {}) as Record<string, unknown>
        })
        .returning({ id: preset.id })
    )
  )
  return row!.id
}

export const seedResume = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly title: string
}): Promise<string> =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(resume)
          .values({
            userId: input.userId,
            hhAccountId: input.accountId,
            externalId: unique("resume"),
            hash: randomUUID(),
            title: input.title,
            text: input.title
          })
          .returning({ id: resume.id })
        return row!.id
      })
    )
  )

export const seedApplication = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly vacancyId: string
  readonly state?: "draft" | "queued" | "submitted"
  readonly resumeId?: string
}): Promise<string> =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(application)
          .values({
            userId: input.userId,
            hhAccountId: input.accountId,
            vacancyId: input.vacancyId,
            resumeId: input.resumeId ?? null,
            state: input.state ?? "queued"
          })
          .returning({ id: application.id })
        return row!.id
      })
    )
  )

export const seedKit = async (input: {
  readonly userId: string
  readonly applicationId: string
}) => {
  return runAs(
    input.userId,
    ownerTx((tx) =>
      ApplicationRepository.upsertKit(tx, {
        userId: input.userId,
        applicationId: input.applicationId,
        formHash: unique("form"),
        letter: "integration test",
        answers: [],
        model: null,
        promptHash: null,
        costUsd: null
      })
    )
  )
}

export const enqueueJob = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly applicationId?: string | null
  readonly stage: JobStage
  readonly kind?: JobKind
  readonly payload?: Record<string, unknown>
  readonly priority?: number
  readonly maxAttempts?: number
  readonly runAt?: Date
  readonly idempotencyKey?: string
}) =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      QueueRepository.enqueue(tx, {
        userId: input.userId,
        hhAccountId: input.accountId,
        applicationId: input.applicationId ?? null,
        stage: input.stage,
        kind: input.kind ?? "browser",
        payload: input.payload ?? {},
        priority: input.priority,
        maxAttempts: input.maxAttempts,
        runAt: input.runAt,
        idempotencyKey: input.idempotencyKey ?? unique(`it-${input.stage}`)
      })
    )
  )

/** Enqueues through the real `submitJob`, whose key is constant per application. */
export const enqueueSubmitJob = async (input: {
  readonly userId: string
  readonly accountId: string
  readonly applicationId: string
  readonly vacancyId: string
  readonly canonicalUrl: string
  readonly kit: KitRecord
  readonly resumeId?: string | null
}) =>
  runAs(
    input.userId,
    ownerTx((tx) =>
      submitJob(tx, {
        userId: input.userId,
        hhAccountId: input.accountId,
        applicationId: input.applicationId,
        vacancyId: input.vacancyId,
        canonicalUrl: input.canonicalUrl,
        externalId: "100500",
        kit: input.kit,
        resumeId: input.resumeId ?? null
      })
    )
  )
