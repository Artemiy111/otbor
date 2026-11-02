import type { DecisionRecord } from "@otbor/contract"
import { call } from "@/shared/api"

export interface DecisionListInput {
  readonly verdict?: string
  readonly limit?: number
  readonly offset?: number
}

export const decisionApi = {
  list: (input: DecisionListInput): Promise<ReadonlyArray<DecisionRecord>> =>
    call((client) => client.DecisionsList(input))
}
