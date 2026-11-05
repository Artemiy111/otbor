import type { ResumeRecord } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

export interface StoredResume {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string
  readonly source: string
  readonly external_id: string
  readonly hash: string
  readonly content_hash: string | null
  readonly title: string
  readonly text: string
  readonly about: string
  readonly skills: unknown
  readonly experience: unknown
  readonly education: unknown
  readonly work_formats: unknown
  readonly salary_amount: number | null
  readonly salary_currency: string | null
  readonly status: string | null
  readonly area_name: string | null
  readonly relocation: string | null
  readonly business_trip_readiness: string | null
  readonly travel_time: string | null
  readonly is_active: boolean
  readonly last_seen_at: Date | string
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : []

const asStringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.map((v) => String(v)) : []

export const toRecord = (row: StoredResume): ResumeRecord => ({
  id: row.id as ResumeRecord["id"],
  hhAccountId: row.hh_account_id as ResumeRecord["hhAccountId"],
  source: row.source,
  externalId: row.external_id,
  title: row.title,
  text: row.text,
  about: row.about ?? "",
  skills: [...asStringArray(row.skills)],
  experience: [...asArray(row.experience)] as ResumeRecord["experience"],
  education: row.education ?? null,
  workFormats: [...asStringArray(row.work_formats)],
  salaryAmount: row.salary_amount,
  salaryCurrency: row.salary_currency,
  status: row.status,
  areaName: row.area_name,
  relocation: row.relocation,
  businessTripReadiness: row.business_trip_readiness,
  travelTime: row.travel_time,
  isActive: row.is_active,
  lastSeenAt: iso(row.last_seen_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

const selection = sql`
  select id, user_id, hh_account_id, source, external_id, hash, content_hash,
         title, text, about, skills, experience, education, work_formats,
         salary_amount, salary_currency, status, area_name, relocation,
         business_trip_readiness, travel_time, is_active, last_seen_at,
         created_at, updated_at
  from resume
`

export const list = (
  tx: Executor,
  userId: string,
  hhAccountId?: string | null
): RepoEffect<ReadonlyArray<ResumeRecord>> =>
  tx
    .execute(
      hhAccountId
        ? sql`${selection} where user_id = ${userId} and hh_account_id = ${hhAccountId}::uuid order by created_at desc`
        : sql`${selection} where user_id = ${userId} order by created_at desc`
    )
    .pipe(Effect.map((result) => (result.rows as unknown as ReadonlyArray<StoredResume>).map(toRecord)))

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<StoredResume | null> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId} and id = ${id}::uuid
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as unknown as StoredResume | undefined) ?? null))

export const findById = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<ResumeRecord | null> =>
  find(tx, userId, id).pipe(Effect.map((row) => (row === null ? null : toRecord(row))))

export const findBySourceExternal = (
  tx: Executor,
  userId: string,
  source: string,
  externalId: string
): RepoEffect<StoredResume | null> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId} and source = ${source} and external_id = ${externalId}
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as unknown as StoredResume | undefined) ?? null))

export interface UpsertResumeInput {
  readonly userId: string
  readonly id?: string | null
  readonly hhAccountId: string
  readonly source?: string
  readonly externalId: string
  readonly title: string
  readonly text: string
  readonly about?: string | null
  readonly skills?: ReadonlyArray<string>
  readonly experience?: unknown
  readonly education?: unknown
  readonly workFormats?: ReadonlyArray<string>
  readonly salaryAmount?: number | null
  readonly salaryCurrency?: string | null
  readonly status?: string | null
  readonly areaName?: string | null
  readonly relocation?: string | null
  readonly businessTripReadiness?: string | null
  readonly travelTime?: string | null
  readonly isActive?: boolean
  readonly lastSeenAt?: Date | string | null
  readonly now?: Date
}

export const upsert = (
  tx: Executor,
  input: UpsertResumeInput
): RepoEffect<ResumeRecord> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date()
    const source = input.source ?? "hh"
    const existing =
      input.id !== null && input.id !== undefined
        ? yield* find(tx, input.userId, input.id)
        : yield* findBySourceExternal(tx, input.userId, source, input.externalId)

    const skills = input.skills ?? []
    const workFormats = input.workFormats ?? []
    const about = input.about ?? ""
    const isActive = input.isActive ?? false
    const lastSeenAt = input.lastSeenAt ?? now

    if (existing !== null) {
      const result = yield* tx.execute(sql`
        update resume set
          hh_account_id = ${input.hhAccountId}::uuid,
          source = ${source},
          external_id = ${input.externalId},
          title = ${input.title},
          text = ${input.text},
          about = ${about},
          skills = ${JSON.stringify(skills)}::jsonb,
          experience = ${JSON.stringify(input.experience ?? existing.experience)}::jsonb,
          education = ${JSON.stringify(input.education ?? existing.education)}::jsonb,
          work_formats = ${JSON.stringify(workFormats)}::jsonb,
          salary_amount = ${input.salaryAmount === undefined ? existing.salary_amount : input.salaryAmount},
          salary_currency = ${input.salaryCurrency === undefined ? existing.salary_currency : input.salaryCurrency},
          status = ${input.status === undefined ? existing.status : input.status},
          area_name = ${input.areaName === undefined ? existing.area_name : input.areaName},
          relocation = ${input.relocation === undefined ? existing.relocation : input.relocation},
          business_trip_readiness = ${input.businessTripReadiness === undefined ? existing.business_trip_readiness : input.businessTripReadiness},
          travel_time = ${input.travelTime === undefined ? existing.travel_time : input.travelTime},
          is_active = ${isActive},
          last_seen_at = ${lastSeenAt},
          updated_at = ${now}
        where id = ${existing.id}::uuid
        returning *
      `)
      return toRecord(result.rows[0] as unknown as StoredResume)
    }

    const inserted = yield* tx.execute(sql`
      insert into resume (
        user_id, hh_account_id, source, external_id, hash, content_hash,
        title, text, about, skills, experience, education, work_formats,
        salary_amount, salary_currency, status, area_name, relocation,
        business_trip_readiness, travel_time, is_active, last_seen_at
      ) values (
        ${input.userId}, ${input.hhAccountId}::uuid, ${source}, ${input.externalId},
        ${""}, ${null},
        ${input.title}, ${input.text}, ${about},
        ${JSON.stringify(skills)}::jsonb,
        ${JSON.stringify(input.experience ?? [])}::jsonb,
        ${JSON.stringify(input.education ?? [])}::jsonb,
        ${JSON.stringify(workFormats)}::jsonb,
        ${input.salaryAmount ?? null},
        ${input.salaryCurrency ?? null},
        ${input.status ?? null},
        ${input.areaName ?? null},
        ${input.relocation ?? null},
        ${input.businessTripReadiness ?? null},
        ${input.travelTime ?? null},
        ${isActive},
        ${lastSeenAt}
      )
      returning *
    `)
    return toRecord(inserted.rows[0] as unknown as StoredResume)
  })

export const remove = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      delete from resume where user_id = ${userId} and id = ${id}::uuid returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))