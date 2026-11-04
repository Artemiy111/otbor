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
        or(
          isNull(vacancyAnalysis.vacancyId),
          gt(vacancy.updatedAt, vacancyAnalysis.updatedAt),
          gt(employer.updatedAt, vacancyAnalysis.updatedAt)
        )
      )
    )
    .orderBy(sql`${vacancyAnalysis.updatedAt} asc nulls first`, vacancy.id)
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
