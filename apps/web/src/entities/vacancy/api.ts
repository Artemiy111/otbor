import type { GateVerdict, VacancyAnalysis, VacancyDetail, VacancySummary } from "@otbor/contract"
import type { VacancyId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface VacancyListInput {
  readonly limit?: number
  readonly offset?: number
  readonly gate?: string
  readonly includeArchived?: boolean
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
}

export interface VacancyListResult {
  readonly items: ReadonlyArray<VacancySummary>
  readonly total: number
}

export const vacancyApi = {
  list: (input: VacancyListInput): Promise<VacancyListResult> =>
    call((client) =>
      client.VacanciesList({
        limit: input.limit,
        offset: input.offset,
        gate: input.gate,
        includeArchived: input.includeArchived,
        includeBlacklisted: input.includeBlacklisted,
        hhAccountId: input.hhAccountId as any
      })
    ),
  get: (id: string): Promise<VacancyDetail> =>
    call((client) => client.VacanciesGet({ id: id as VacancyId })),
  analysis: (id: string): Promise<VacancyAnalysis | null> =>
    call((client) => client.VacancyAnalysisGet({ vacancyId: id as VacancyId })),
  hydrate: (id: string, force = false): Promise<{ readonly hydrated: boolean }> =>
    call((client) => client.VacanciesHydrateOne({ id: id as VacancyId, force: force || undefined })),
  titlePreview: (title: string): Promise<{ readonly verdict: GateVerdict }> =>
    call((client) => client.TitlesPreview({ title }))
}
