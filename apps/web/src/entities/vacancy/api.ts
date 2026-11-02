import type { GateVerdict, VacancyDetail, VacancySummary } from "@otbor/contract"
import type { VacancyId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface VacancyListInput {
  readonly limit?: number
  readonly offset?: number
  readonly gate?: string
  readonly includeArchived?: boolean
}

export interface VacancyListResult {
  readonly items: ReadonlyArray<VacancySummary>
  readonly total: number
}

export const vacancyApi = {
  list: (input: VacancyListInput): Promise<VacancyListResult> =>
    call((client) => client.VacanciesList(input)),
  get: (id: string): Promise<VacancyDetail> =>
    call((client) => client.VacanciesGet({ id: id as VacancyId })),
  titlePreview: (title: string): Promise<{ readonly verdict: GateVerdict }> =>
    call((client) => client.TitlesPreview({ title }))
}
