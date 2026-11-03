import type { FitJudgement } from "@otbor/contract"
import {
  currentFitVersions,
  digestResume,
  type FitResumeInput,
  type FitVacancyInput
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as FitJudgementRepository from "../repositories/FitJudgementRepository.ts"
import * as ResumeEnrichmentRepository from "../repositories/ResumeEnrichmentRepository.ts"
import * as ResumeRepository from "../repositories/ResumeRepository.ts"
import type * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { stableHash } from "./support.ts"

export const fitVacancyInput = (row: VacancyRepository.VacancyRow): FitVacancyInput => ({
  title: row.title,
  employerName: row.employerName,
  salaryFrom: row.salaryFrom,
  salaryTo: row.salaryTo,
  salaryCurrency: row.salaryCurrency,
  workFormats: row.workFormats,
  seniority: row.seniority,
  skills: row.skills,
  descriptionText: row.descriptionText
})

/**
 * The hash of everything about a resume that reaches the model: the stripped,
 * trimmed digest. Editing a part the prompt never sees does not invalidate a
 * judgement; editing the text, skills, expectation or notes does.
 */
export const resumeHashOf = (input: FitResumeInput): string => stableHash(digestResume(input))

export interface LoadedResume {
  readonly id: string
  readonly input: FitResumeInput
  readonly hash: string
}

export const loadResume = (
  tx: Executor,
  userId: string,
  resumeId: string
): RepoEffect<LoadedResume | null> =>
  Effect.gen(function*() {
    const row = yield* ResumeRepository.find(tx, userId, resumeId)
    if (row === null) return null
    const enrichment = yield* ResumeEnrichmentRepository.get(tx, userId, resumeId)

    const asStrings = (value: unknown): ReadonlyArray<string> =>
      Array.isArray(value) ? value.map(String) : []

    const input: FitResumeInput = {
      title: row.title,
      text: row.text,
      about: row.about,
      skills: asStrings(row.skills),
      workFormats: asStrings(row.work_formats),
      salaryAmount: row.salary_amount,
      salaryCurrency: row.salary_currency,
      enrichment: enrichment === null
        ? null
        : {
            comment: enrichment.comment,
            salaryMin: enrichment.salaryMin ?? null,
            salaryExpectation: enrichment.salaryExpectation ?? null,
            currency: enrichment.currency ?? null
          }
    }
    return { id: row.id, input, hash: resumeHashOf(input) }
  })

/** The resume to judge against when the caller names none: the active one, else the newest. */
export const defaultResumeId = (tx: Executor, userId: string): RepoEffect<string | null> =>
  tx
    .execute(sql`
      select id::text as id from resume
      where user_id = ${userId}
      order by is_active desc, updated_at desc, id desc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

/**
 * The judgement a decision for this vacancy should use, if there is a current
 * one: finished, made for this exact vacancy content and prompt version, and
 * for a resume whose digest is unchanged. With `resumeId` only that resume
 * counts; otherwise the newest current judgement of any resume wins.
 *
 * Cheap on the common path: one indexed query that finds no rows, and the
 * resume is only loaded when a candidate row exists.
 */
export const currentFitFor = (
  tx: Executor,
  userId: string,
  vacancy: { readonly id: string; readonly contentHash: string },
  resumeId: string | null | undefined
): RepoEffect<{ readonly judgement: FitJudgement; readonly resumeId: string; readonly id: string } | null> =>
  Effect.gen(function*() {
    const rows = yield* FitJudgementRepository.doneFor(
      tx,
      userId,
      vacancy.id,
      vacancy.contentHash,
      currentFitVersions.promptVersion
    )

    const hashes = new Map<string, string | null>()
    for (const row of rows) {
      if (resumeId !== undefined && resumeId !== null && row.resume_id !== resumeId) continue
      if (!hashes.has(row.resume_id)) {
        const loaded = yield* loadResume(tx, userId, row.resume_id)
        hashes.set(row.resume_id, loaded?.hash ?? null)
      }
      if (hashes.get(row.resume_id) !== row.resume_hash) continue

      const judgement = FitJudgementRepository.toJudgement(row)
      if (judgement !== null) return { judgement, resumeId: row.resume_id, id: row.id }
    }
    return null
  })
