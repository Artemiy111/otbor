import type { VacancyAnalysis, VacancyAnalysisFacts } from "@otbor/contract"
import type { AnalysisInput } from "@otbor/domain"
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { employer, vacancy, vacancyAnalysis } from "../db/tables.ts"

/**
 * Shared table: everyone reads, only the owner writes (the analysis runner runs
 * as the owner). The expected `inputHash` is computed by the runner from the
 * exact state it would send; the repository only narrows the candidates.
 */

export interface StoredAnalysis {
  readonly vacancyId: string
  readonly promptVersion: string
  readonly inputHash: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly facts: VacancyAnalysisFacts
  readonly threshold: number
  readonly latencyMs: number | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

const iso = (value: Date): string => value.toISOString()

export const toAnalysis = (row: StoredAnalysis): VacancyAnalysis => ({
  vacancyId: row.vacancyId as VacancyAnalysis["vacancyId"],
  promptVersion: row.promptVersion,
  inputHash: row.inputHash,
  model: row.model,
  threshold: row.threshold,
  facts: row.facts,
  latencyMs: row.latencyMs,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
})

export const get = (
  tx: Executor,
  vacancyId: string,
  promptVersion: string
): RepoEffect<StoredAnalysis | null> =>
  tx
    .select()
    .from(vacancyAnalysis)
    .where(and(eq(vacancyAnalysis.vacancyId, vacancyId), eq(vacancyAnalysis.promptVersion, promptVersion)))
    .limit(1)
    .pipe(Effect.map((rows) => rows[0] ?? null))

/** One query for a batch: the stored analyses of `vacancyIds` under the prompt version, by vacancy id. */
export const getMany = (
  tx: Executor,
  vacancyIds: ReadonlyArray<string>,
  promptVersion: string
): RepoEffect<ReadonlyMap<string, StoredAnalysis>> =>
  vacancyIds.length === 0
    ? Effect.succeed(new Map())
    : tx
        .select()
        .from(vacancyAnalysis)
        .where(and(inArray(vacancyAnalysis.vacancyId, [...vacancyIds]), eq(vacancyAnalysis.promptVersion, promptVersion)))
        .pipe(Effect.map((rows) => new Map(rows.map((row) => [row.vacancyId, row]))))

export interface UpsertAnalysisInput {
  readonly vacancyId: string
  readonly promptVersion: string
  readonly inputHash: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly facts: VacancyAnalysisFacts
  readonly threshold: number
  readonly latencyMs: number | null
}

/** One row per (vacancy, prompt version): a re-analysis replaces the previous one. */
export const upsert = (tx: Executor, input: UpsertAnalysisInput): RepoEffect<StoredAnalysis> =>
  tx
    .insert(vacancyAnalysis)
    .values(input)
    .onConflictDoUpdate({
      target: [vacancyAnalysis.vacancyId, vacancyAnalysis.promptVersion],
      set: {
        inputHash: input.inputHash,
        model: input.model,
        answers: input.answers,
        facts: input.facts,
        threshold: input.threshold,
        latencyMs: input.latencyMs
      }
    })
    .returning()
    .pipe(Effect.map((rows) => rows[0]!))

/**
 * The stored input is still current: bump `updated_at` (the trigger does it) so
 * the row stops being a candidate until the vacancy or employer changes again.
 */
export const markFresh = (
  tx: Executor,
  vacancyId: string,
  promptVersion: string
): RepoEffect<void> =>
  tx
    .update(vacancyAnalysis)
    .set({ inputHash: sql`${vacancyAnalysis.inputHash}` })
    .where(and(eq(vacancyAnalysis.vacancyId, vacancyId), eq(vacancyAnalysis.promptVersion, promptVersion)))
    .pipe(Effect.asVoid)

export interface AnalysisCandidate {
  readonly vacancyId: string
  /** Everything `buildAnalysisState` needs. */
  readonly input: AnalysisInput
  /** hh `employer.category`, for the agency override. */
  readonly employerCategory: string | null
  /** The stored analysis, when there is one (it may still be stale). */
  readonly current: { readonly inputHash: string; readonly updatedAt: Date } | null
}

export interface CandidateOptions {
  readonly promptVersion: string
  readonly limit: number
  /** Skip the first rows, so a runner can page past candidates that turned out fresh. */
  readonly offset?: number
}

/**
 * Fully hydrated vacancies that have no analysis for the prompt version, or
 * whose vacancy or employer row changed after it was written, never-analysed
 * first and then the oldest analysis. A candidate is only a *possible* stale
 * row: the runner compares the hash of the state it builds against
 * `current.inputHash` and calls `markFresh` when they match.
 */
export const listCandidates = (
  tx: Executor,
  options: CandidateOptions
): RepoEffect<ReadonlyArray<AnalysisCandidate>> =>
  tx
    .select({
      vacancyId: vacancy.id,
      title: vacancy.title,
      areaName: vacancy.areaName,
      salaryFrom: vacancy.salaryFrom,
      salaryTo: vacancy.salaryTo,
      salaryCurrency: vacancy.salaryCurrency,
      workFormats: vacancy.workFormats,
      experienceCode: vacancy.experienceCode,
      descriptionText: vacancy.descriptionText,
      employerId: employer.id,
      employerName: employer.name,
      employerCategory: employer.category,
      employerSize: employer.sizeCategory,
      employerAddress: employer.address,
      employerAccreditedIt: employer.accreditedIt,
      employerIndustries: employer.industries,
      employerDescription: employer.descriptionText,
      analysisHash: vacancyAnalysis.inputHash,
      analysisUpdatedAt: vacancyAnalysis.updatedAt
    })
    .from(vacancy)
    .leftJoin(employer, eq(vacancy.employerId, employer.id))
    .leftJoin(
      vacancyAnalysis,
      and(eq(vacancyAnalysis.vacancyId, vacancy.id), eq(vacancyAnalysis.promptVersion, options.promptVersion))
    )
    .where(
      and(
        eq(vacancy.hydrationStatus, "full"),
        eq(vacancy.archived, false),
        or(
          isNull(vacancyAnalysis.vacancyId),
          gt(vacancy.updatedAt, vacancyAnalysis.updatedAt),
          gt(employer.updatedAt, vacancyAnalysis.updatedAt)
        )
      )
    )
    .orderBy(sql`${vacancyAnalysis.updatedAt} asc nulls first`, sql`${vacancy.publishedAt} desc nulls last`, vacancy.id)
    .limit(options.limit)
    .offset(options.offset ?? 0)
    .pipe(
      Effect.map((rows) =>
        rows.map((row): AnalysisCandidate => ({
          vacancyId: row.vacancyId,
          input: {
            title: row.title,
            areaName: row.areaName,
            salaryFrom: row.salaryFrom,
            salaryTo: row.salaryTo,
            salaryCurrency: row.salaryCurrency,
            workFormats: row.workFormats,
            experienceCode: row.experienceCode,
            descriptionText: row.descriptionText,
            employer:
              row.employerId === null
                ? null
                : {
                    name: row.employerName,
                    category: row.employerCategory,
                    sizeCategory: row.employerSize,
                    address: row.employerAddress,
                    accreditedIt: row.employerAccreditedIt,
                    industries: row.employerIndustries,
                    descriptionText: row.employerDescription
                  }
          },
          employerCategory: row.employerCategory,
          current:
            row.analysisHash === null || row.analysisUpdatedAt === null
              ? null
              : { inputHash: row.analysisHash, updatedAt: row.analysisUpdatedAt }
        }))
      )
    )

export interface AnalysisCounts {
  /** Fully hydrated vacancies. */
  readonly total: number
  /** Of those, with a stored analysis for the prompt version. */
  readonly analysed: number
}

export const counts = (tx: Executor, promptVersion: string): RepoEffect<AnalysisCounts> =>
  tx
    .select({
      total: sql<number>`count(*)::int`,
      analysed: sql<number>`count(${vacancyAnalysis.vacancyId})::int`
    })
    .from(vacancy)
    .leftJoin(
      vacancyAnalysis,
      and(eq(vacancyAnalysis.vacancyId, vacancy.id), eq(vacancyAnalysis.promptVersion, promptVersion))
    )
    .where(eq(vacancy.hydrationStatus, "full"))
    .pipe(Effect.map((rows) => ({ total: rows[0]?.total ?? 0, analysed: rows[0]?.analysed ?? 0 })))


const intOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Math.round(Number(value))

const latencyRow = (row: Record<string, unknown> | undefined) => ({
  count: Number(row?.count ?? 0),
  avgMs: intOrNull(row?.avg_ms),
  p50Ms: intOrNull(row?.p50_ms),
  p95Ms: intOrNull(row?.p95_ms),
  maxMs: intOrNull(row?.max_ms)
})

const LATENCY_COLUMNS = sql`
  count(latency_ms)::int as count,
  avg(latency_ms) as avg_ms,
  percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
  max(latency_ms) as max_ms`

/** Speed and volume of the model over the last `days` days, for the insights page. */
export const insights = (tx: Executor, promptVersion: string, days: number) =>
  Effect.gen(function*() {
    const since = sql`now() - (${days} * interval '1 day')`
    const base = sql`from vacancy_analysis where prompt_version = ${promptVersion} and created_at > ${since}`

    const overall = yield* tx.execute(sql`select ${LATENCY_COLUMNS} ${base}`)
    const perDay = yield* tx.execute(sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
             count(*)::int as count, avg(latency_ms) as avg_ms
      ${base} group by 1 order by 1`)
    const perModel = yield* tx.execute(sql`
      select model, ${LATENCY_COLUMNS} ${base} group by model order by count desc`)
    const slowest = yield* tx.execute(sql`
      select a.vacancy_id::text as vacancy_id, v.title, a.model, a.latency_ms, a.created_at
      from vacancy_analysis a join vacancy v on v.id = a.vacancy_id
      where a.prompt_version = ${promptVersion} and a.created_at > ${since} and a.latency_ms is not null
      order by a.latency_ms desc limit 8`)
    const runs = yield* tx.execute(sql`
      select started_at, status,
             greatest(extract(epoch from (coalesce(finished_at, now()) - started_at)), 0)::int as seconds,
             coalesce((detail->>'analysed')::int, 0) as analysed,
             coalesce((detail->>'skipped')::int, 0) as skipped,
             coalesce((detail->>'failed')::int, 0) as failed,
             detail->>'stoppedBy' as stopped_by
      from schedule_run where kind = 'analysis' and started_at > ${since}
      order by started_at desc limit 40`)

    return {
      latency: latencyRow(overall.rows[0] as Record<string, unknown> | undefined),
      byDay: perDay.rows.map((r) => ({
        day: String((r as Record<string, unknown>).day),
        count: Number((r as Record<string, unknown>).count),
        avgMs: intOrNull((r as Record<string, unknown>).avg_ms)
      })),
      byModel: perModel.rows.map((r) => ({
        model: String((r as Record<string, unknown>).model),
        ...latencyRow(r as Record<string, unknown>)
      })),
      slowest: slowest.rows.map((r) => {
        const o = r as Record<string, unknown>
        return {
          vacancyId: String(o.vacancy_id),
          title: String(o.title ?? ""),
          model: String(o.model),
          latencyMs: Math.round(Number(o.latency_ms)),
          at: new Date(o.created_at as string | Date).toISOString()
        }
      }),
      runs: runs.rows.map((r) => {
        const o = r as Record<string, unknown>
        return {
          startedAt: new Date(o.started_at as string | Date).toISOString(),
          seconds: Number(o.seconds),
          analysed: Number(o.analysed),
          skipped: Number(o.skipped),
          failed: Number(o.failed),
          status: String(o.status),
          stoppedBy: o.stopped_by === null || o.stopped_by === undefined ? null : String(o.stopped_by)
        }
      })
    }
  })
