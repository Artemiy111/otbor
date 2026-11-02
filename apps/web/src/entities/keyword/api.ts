import type { LexiconKeyword } from "@otbor/contract"
import { call } from "@/shared/api"

export interface KeywordListInput {
  readonly query?: string
  readonly limit?: number
}

export const keywordApi = {
  list: (input: KeywordListInput): Promise<ReadonlyArray<LexiconKeyword>> =>
    call((client) => client.LexiconList(input))
}
