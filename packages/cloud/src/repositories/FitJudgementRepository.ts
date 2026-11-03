import type {
  FitJudgement,
  FitJudgementRecord,
  FitJudgementSource,
  FitJudgementStatus,
  FitVerdict
} from "@otbor/contract"
import { sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** The key of one judgement: the inputs it was made from. */
export interface FitKey {
  readonly userId: string
  readonly vacancyId: string
  readonly resumeId: string
  readonly vacancyContentHash: string
  readonly resumeHash: string
  readonly promptVersion: string
}

export interface FitRow {
  readonly id: string
  readonly user_id: string
  readonly vacancy_id: string
  readonly resume_id: string
  readonly vacancy_content_hash: string
  readonly resume_hash: string
  readonly prompt_version: string
  readonly source: string
  readonly status: string
  readonly fit: number | null
  readonly confidence: number | null
  readonly verdict: string | null
  readonly reasons: unknown
  readonly disqualifiers: unknown
  readonly quotes: unknown
  readonly model: string | null
  readonly inference_job_id: string | null
  readonly error: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.map(String) : []

export const toJudgement = (row: FitRow): FitJudgement | null =>
  row.status === "done" && row.fit !== null && row.confidence !== null && row.verdict !== null
    ? {
        fit: row.fit,
        confidence: row.confidence,
        verdict: row.verdict as FitVerdict,
        reasons: strings(row.reasons),
        disqualifiers: strings(row.disqualifiers),
        quotes: strings(row.quotes)
      }
    : null

/** `current` is decided by the caller, who knows the live vacancy and resume hashes. */
export const toRecord = (row: FitRow, current: boolean): FitJudgementRecord => ({
  id: row.id,
  vacancyId: row.vacancy_id as FitJudgementRecord["vacancyId"],
  resumeId: row.resume_id as FitJudgementRecord["resumeId"],
  vacancyContentHash: row.vacancy_content_hash,
  resumeHash: row.resume_hash,
  promptVersion: row.prompt_version,
  source: row.source as FitJudgementSource,
  status: row.status as FitJudgementStatus,
  judgement: toJudgement(row),
  model: row.model,
  inferenceJobId: row.inference_job_id as FitJudgementRecord["inferenceJobId"],
  error: row.error,
  current,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

const json = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`

const first = (result: { readonly rows: ReadonlyArray<unknown> }): FitRow =>
  result.rows[0] as unknown as FitRow

/** A job was enqueued for this key; a re-judgement replaces whatever was there. */
export const upsertPending = (
  tx: Executor,
  key: FitKey,
  jobId: string
): RepoEffect<FitRow> =>
  tx
    .execute(sql`
      insert into fit_judgement (
        user_id, vacancy_id, resume_id, vacancy_content_hash, resume_hash, prompt_version,
        source, status, inference_job_id
      ) values (
        ${key.userId}, ${key.vacancyId}::uuid, ${key.resumeId}::uuid, ${key.vacancyContentHash},
        ${key.resumeHash}, ${key.promptVersion}, 'llm', 'pending', ${jobId}::uuid
      )
      on conflict (user_id, vacancy_id, resume_id, vacancy_content_hash, resume_hash, prompt_version)
      do update set
        source = 'llm', status = 'pending', inference_job_id = excluded.inference_job_id,
        fit = null, confidence = null, verdict = null,
        reasons = '[]'::jsonb, disqualifiers = '[]'::jsonb, quotes = '[]'::jsonb,
        model = null, error = null
      returning *
    `)
    .pipe(Effect.map(first))

export interface DoneInput {
  readonly key: FitKey
  readonly source: FitJudgementSource
  readonly judgement: FitJudgement
  readonly model: string | null
  /** The job that produced it; null for an external judgement. */
  readonly jobId: string | null
}

/** Stores a finished judgement, replacing a pending or older row with the same key. */
export const upsertDone = (tx: Executor, input: DoneInput): RepoEffect<FitRow> =>
  tx
    .execute(sql`
      insert into fit_judgement (
        user_id, vacancy_id, resume_id, vacancy_content_hash, resume_hash, prompt_version,
        source, status, fit, confidence, verdict, reasons, disqualifiers, quotes, model,
        inference_job_id
      ) values (
        ${input.key.userId}, ${input.key.vacancyId}::uuid, ${input.key.resumeId}::uuid,
        ${input.key.vacancyContentHash}, ${input.key.resumeHash}, ${input.key.promptVersion},
        ${input.source}, 'done', ${input.judgement.fit}, ${input.judgement.confidence},
        ${input.judgement.verdict}, ${json(input.judgement.reasons)},
        ${json(input.judgement.disqualifiers)}, ${json(input.judgement.quotes)}, ${input.model},
        ${input.jobId === null ? null : sql`${input.jobId}::uuid`}
      )
      on conflict (user_id, vacancy_id, resume_id, vacancy_content_hash, resume_hash, prompt_version)
      do update set
        source = excluded.source, status = 'done', fit = excluded.fit,
        confidence = excluded.confidence, verdict = excluded.verdict,
        reasons = excluded.reasons, disqualifiers = excluded.disqualifiers,
        quotes = excluded.quotes, model = excluded.model,
        inference_job_id = excluded.inference_job_id, error = null
      returning *
    `)
    .pipe(Effect.map(first))

/** The pending row waiting for this inference job, if any. */
export const findPendingByJob = (tx: Executor, jobId: string): RepoEffect<FitRow | null> =>
  tx
    .execute(sql`
      select * from fit_judgement
      where inference_job_id = ${jobId}::uuid and status = 'pending'
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as unknown as FitRow | undefined) ?? null))

export const markFailed = (tx: Executor, id: string, error: string): RepoEffect<void> =>
  tx
    .execute(sql`
      update fit_judgement set status = 'failed', error = ${error.slice(0, 500)}
      where id = ${id}::uuid
    `)
    .pipe(Effect.asVoid)

/** Judgements of a vacancy, newest first; optionally for one resume. */
export const listForVacancy = (
  tx: Executor,
  userId: string,
  vacancyId: string,
  resumeId?: string
): RepoEffect<ReadonlyArray<FitRow>> =>
  tx
    .execute(sql`
      select * from fit_judgement
      where user_id = ${userId} and vacancy_id = ${vacancyId}::uuid
        ${resumeId === undefined ? sql`` : sql`and resume_id = ${resumeId}::uuid`}
      order by updated_at desc, id desc
    `)
    .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<FitRow>))

/** Finished judgements made for exactly this vacancy content and prompt version. */
export const doneFor = (
  tx: Executor,
  userId: string,
  vacancyId: string,
  vacancyContentHash: string,
  promptVersion: string
): RepoEffect<ReadonlyArray<FitRow>> =>
  tx
    .execute(sql`
      select * from fit_judgement
      where user_id = ${userId} and vacancy_id = ${vacancyId}::uuid
        and status = 'done'
        and vacancy_content_hash = ${vacancyContentHash}
        and prompt_version = ${promptVersion}
      order by updated_at desc, id desc
    `)
    .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<FitRow>))

export interface ListOptions {
  readonly status?: FitJudgementStatus
  readonly resumeId?: string
  readonly limit?: number
  readonly offset?: number
}

export const list = (
  tx: Executor,
  userId: string,
  options: ListOptions = {}
): RepoEffect<ReadonlyArray<FitRow>> =>
  tx
    .execute(sql`
      select * from fit_judgement
      where user_id = ${userId}
        ${options.status === undefined ? sql`` : sql`and status = ${options.status}`}
        ${options.resumeId === undefined ? sql`` : sql`and resume_id = ${options.resumeId}::uuid`}
      order by updated_at desc, id desc
      limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
      offset ${Math.max(options.offset ?? 0, 0)}
    `)
    .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<FitRow>))

export const countPending = (tx: Executor, userId: string): RepoEffect<number> =>
  tx
    .execute(sql`
      select count(*)::int as count from fit_judgement
      where user_id = ${userId} and status = 'pending'
    `)
    .pipe(
      Effect.map((result) => Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0))
    )

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

export interface CandidateOptions {
  readonly userId: string
  readonly resumeId: string
  readonly resumeHash: string
  readonly promptVersion: string
  /** `true`: latest decision is `apply`. `false`: any vacancy that passed the title gate. */
  readonly onlyApply: boolean
  readonly force: boolean
  /** A preset's vacancy filter, already compiled over the `vacancy` table. */
  readonly vacancyFilter?: SQL
}

/**
 * Vacancies, best decision priority first, that still need a judgement for
 * this resume: no row for the current inputs, a failed one, or (`force`) a
 * finished one. A pending row counts as covered, so one vacancy never has two
 * jobs in flight.
 */
const candidatesFrom = (options: CandidateOptions) => sql`
  from (
    select distinct on (x.vacancy_id) x.vacancy_id, x.verdict, x.gate, x.priority, x.fit
    from decision x
    where x.user_id = ${options.userId}
    order by x.vacancy_id, x.created_at desc, x.id desc
  ) d
  join vacancy on vacancy.id = d.vacancy_id
  left join fit_judgement j
    on j.user_id = ${options.userId}
   and j.vacancy_id = vacancy.id
   and j.resume_id = ${options.resumeId}::uuid
   and j.vacancy_content_hash = vacancy.content_hash
   and j.resume_hash = ${options.resumeHash}
   and j.prompt_version = ${options.promptVersion}
  where ${options.onlyApply ? sql`d.verdict = 'apply'` : sql`d.gate = 'match'`}
    and not vacancy.archived
    and (
      j.id is null
      or j.status = 'failed'
      or (${options.force ? sql`true` : sql`false`} and j.status = 'done')
    )
    ${options.vacancyFilter === undefined ? sql`` : sql`and ${options.vacancyFilter}`}
`

export const candidateVacancyIds = (
  tx: Executor,
  options: CandidateOptions & { readonly limit: number }
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select vacancy.id::text as id
      ${candidatesFrom(options)}
      order by d.priority desc, d.fit desc, vacancy.id
      limit ${options.limit}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ id: string }>).map((row) => row.id)
      )
    )

export const countCandidates = (tx: Executor, options: CandidateOptions): RepoEffect<number> =>
  tx
    .execute(sql`select count(*)::int as count ${candidatesFrom(options)}`)
    .pipe(
      Effect.map((result) => Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0))
    )
