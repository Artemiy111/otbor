import type { DecisionRecord, HhAccountId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface DecisionListInput {
  readonly verdict?: string
  readonly hhAccountId?: string
  readonly limit?: number
  readonly offset?: number
}

export const decisionApi = {
  list: (input: DecisionListInput): Promise<ReadonlyArray<DecisionRecord>> =>
    call((client) => client.DecisionsList({ ...input, hhAccountId: input.hhAccountId as HhAccountId | undefined }))
}
