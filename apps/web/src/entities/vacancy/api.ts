import type { DecisionRecord, HhAccountId, PresetFilter, VacancyAnalysis, VacancyDetail, VacancySummary } from "@otbor/contract"
import type { VacancyId, VacancySort } from "@otbor/contract"
import { call } from "@/shared/api"

export interface VacancyListInput {
  readonly limit?: number
  readonly offset?: number
  readonly analysed?: boolean
  readonly respondedAccountId?: string
  readonly search?: string
  readonly sort?: VacancySort
  readonly includeArchived?: boolean
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
  readonly filter?: PresetFilter
  /** Область решений: резюме внутри аккаунта. */
  readonly resumeId?: string
  readonly verdict?: "apply" | "draft" | "skip" | "none"
  readonly applied?: "yes" | "no"
  /** ISO-время: только вакансии, впервые увиденные не раньше него. */
  readonly seenSince?: string
}

/** Счётчики быстрых фильтров; у сервера без этого поля их просто нет. */
export interface VacancyListCounts {
  readonly all: number
  readonly apply: number
  readonly applied: number
  readonly notApplied: number
  readonly fresh?: number
}

export interface VacancyListResult {
  readonly items: ReadonlyArray<VacancySummary>
  readonly total: number
  readonly scopeHhAccountId?: string | null
  readonly counts?: VacancyListCounts
}

export const vacancyApi = {
  list: (input: VacancyListInput): Promise<VacancyListResult> =>
    call((client) =>
      client.VacanciesList({
        limit: input.limit,
        offset: input.offset,
        analysed: input.analysed,
        respondedAccountId: input.respondedAccountId as any,
        search: input.search,
        sort: input.sort,
        includeArchived: input.includeArchived,
        includeBlacklisted: input.includeBlacklisted,
        hhAccountId: input.hhAccountId as any,
        filter: input.filter,
        resumeId: input.resumeId as any,
        verdict: input.verdict,
        applied: input.applied,
        seenSince: input.seenSince
      })
    ),
  get: (id: string): Promise<VacancyDetail> =>
    call((client) => client.VacanciesGet({ id: id as VacancyId })),
  analysis: (id: string): Promise<VacancyAnalysis | null> =>
    call((client) => client.VacancyAnalysisGet({ vacancyId: id as VacancyId })),
  /** Пересчитывает решение по вакансии для аккаунта и резюме (без обращения к hh). */
  evaluate: (input: {
    readonly vacancyId: string
    readonly hhAccountId?: string
    readonly resumeId?: string
  }): Promise<DecisionRecord> =>
    call((client) =>
      client.VacanciesEvaluate({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: (input.hhAccountId || undefined) as HhAccountId | undefined,
        resumeId: input.resumeId || undefined
      })
    ),
  hydrate: (id: string, force = false): Promise<{ readonly hydrated: boolean }> =>
    call((client) => client.VacanciesHydrateOne({ id: id as VacancyId, force: force || undefined }))
}
