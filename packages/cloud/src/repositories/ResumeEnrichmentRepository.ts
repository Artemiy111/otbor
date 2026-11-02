import type { ResumeEnrichment, ResumeId } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

export interface StoredResumeEnrichment {
  readonly user_id: string
  readonly resume_id: string
  readonly data: Record<string, unknown> | null
  readonly updated_at: Date | string
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toEnrichment = (row: StoredResumeEnrichment): ResumeEnrichment => {
  const data = (row.data ?? {}) as Record<string, unknown>
  const exp = Array.isArray(data.experience) ? data.experience : []
  return {
    resumeId: row.resume_id as ResumeEnrichment["resumeId"],
    comment: typeof data.comment === "string" ? data.comment : "",
    salaryMin: typeof data.salaryMin === "number" ? data.salaryMin : (data.salaryMin as number | null | undefined) ?? null,
    salaryExpectation:
      typeof data.salaryExpectation === "number"
        ? data.salaryExpectation
        : (data.salaryExpectation as number | null | undefined) ?? null,
    currency: typeof data.currency === "string" ? data.currency : (data.currency as string | null | undefined) ?? null,
    experience: exp.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>
      return {
        key: String(o.key ?? ""),
        employmentType: o.employmentType === undefined ? null : (o.employmentType as string | null),
        comment: o.comment === undefined ? null : (o.comment as string | null),
        leaveReason: o.leaveReason === undefined ? null : (o.leaveReason as string | null)
      }
    }),
    updatedAt: iso(row.updated_at)
  }
}

export const get = (
  tx: Executor,
  userId: string,
  resumeId: string
): RepoEffect<ResumeEnrichment | null> =>
  tx
    .execute(sql`
      select user_id, resume_id, data, updated_at
      from resume_enrichment
      where user_id = ${userId} and resume_id = ${resumeId}::uuid
      limit 1
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as StoredResumeEnrichment | undefined
        return row === undefined ? null : toEnrichment(row)
      })
    )

export interface SaveEnrichmentInput {
  readonly userId: string
  readonly resumeId: string
  readonly data: {
    readonly comment?: string
    readonly salaryMin?: number | null
    readonly salaryExpectation?: number | null
    readonly currency?: string | null
    readonly experience?: ReadonlyArray<{
      readonly key: string
      readonly employmentType?: string | null
      readonly comment?: string | null
      readonly leaveReason?: string | null
    }>
  }
  readonly now?: Date
}

export const save = (
  tx: Executor,
  input: SaveEnrichmentInput
): RepoEffect<ResumeEnrichment> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date()
    const payload = {
      comment: input.data.comment ?? "",
      salaryMin: input.data.salaryMin ?? null,
      salaryExpectation: input.data.salaryExpectation ?? null,
      currency: input.data.currency ?? null,
      experience: (input.data.experience ?? []).map((e) => ({
        key: e.key,
        employmentType: e.employmentType ?? null,
        comment: e.comment ?? null,
        leaveReason: e.leaveReason ?? null
      }))
    }

    const existing = yield* tx.execute(sql`
      select user_id, resume_id, data, updated_at
      from resume_enrichment
      where user_id = ${input.userId} and resume_id = ${input.resumeId}::uuid
      limit 1
    `).pipe(Effect.map((r) => (r.rows[0] as unknown as StoredResumeEnrichment | undefined) ?? null))

    if (existing !== null) {
      const result = yield* tx.execute(sql`
        update resume_enrichment set
          data = ${JSON.stringify(payload)}::jsonb,
          updated_at = ${now}
        where user_id = ${input.userId} and resume_id = ${input.resumeId}::uuid
        returning user_id, resume_id, data, updated_at
      `)
      return toEnrichment(result.rows[0] as unknown as StoredResumeEnrichment)
    }

    const inserted = yield* tx.execute(sql`
      insert into resume_enrichment (user_id, resume_id, data, updated_at)
      values (${input.userId}, ${input.resumeId}::uuid, ${JSON.stringify(payload)}::jsonb, ${now})
      returning user_id, resume_id, data, updated_at
    `)
    return toEnrichment(inserted.rows[0] as unknown as StoredResumeEnrichment)
  })