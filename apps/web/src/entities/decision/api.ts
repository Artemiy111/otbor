import type { DecisionRecord, HhAccountId, PresetFilter } from "@otbor/contract"
import { call } from "@/shared/api"

export interface DecisionListInput {
  readonly verdict?: string
  readonly hhAccountId?: string
  readonly limit?: number
  readonly offset?: number
  /** Оставить только свежее решение по каждой паре «вакансия + аккаунт». */
  readonly latestPerVacancy?: boolean
  /** Произвольные правила по полям вакансии: сужают выборку до нужной вакансии. */
  readonly filter?: PresetFilter
}

export const decisionApi = {
  list: (input: DecisionListInput): Promise<ReadonlyArray<DecisionRecord>> =>
    call((client) => client.DecisionsList({ ...input, hhAccountId: input.hhAccountId as HhAccountId | undefined }))
}
