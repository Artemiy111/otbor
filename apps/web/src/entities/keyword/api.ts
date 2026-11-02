import type { KeywordMatchLocation, LexiconKeyword, PresetId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface KeywordListInput {
  readonly query?: string
  readonly limit?: number
  /** Apply this preset's filter to the keyword set and counts. */
  readonly presetId?: string
  /** Only keywords that matched in this part of a vacancy. */
  readonly location?: KeywordMatchLocation
}

export const keywordApi = {
  list: (input: KeywordListInput): Promise<ReadonlyArray<LexiconKeyword>> =>
    call((client) =>
      client.LexiconList({
        ...input,
        presetId: input.presetId as PresetId | undefined
      })
    )
}
