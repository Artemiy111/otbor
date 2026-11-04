import type { KeywordAliasId, KeywordId, KeywordMatchLocation, LexiconKeyword, PresetId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface KeywordListInput {
  readonly query?: string
  readonly limit?: number
  /** Apply this preset's filter to the keyword set and counts. */
  readonly presetId?: string
  /** Only keywords that matched in this part of a vacancy. */
  readonly location?: KeywordMatchLocation
}

export interface KeywordSaveInput {
  /** Present when editing an existing keyword. */
  readonly id?: string
  readonly term: string
  /** Omit to leave the aliases untouched (a rename). */
  readonly aliases?: ReadonlyArray<string>
}

export const keywordApi = {
  save: (input: KeywordSaveInput): Promise<LexiconKeyword> =>
    call((client) =>
      client.LexiconUpsert({ ...input, id: input.id as KeywordId | undefined })
    ),
  addAlias: (keywordId: string, alias: string) =>
    call((client) => client.LexiconAliasAdd({ keywordId: keywordId as KeywordId, alias })),
  removeAlias: (id: string) =>
    call((client) => client.LexiconAliasRemove({ id: id as KeywordAliasId })),
  remove: (id: string) => call((client) => client.LexiconRemove({ id: id as KeywordId })),
  list: (input: KeywordListInput): Promise<ReadonlyArray<LexiconKeyword>> =>
    call((client) =>
      client.LexiconList({
        ...input,
        presetId: input.presetId as PresetId | undefined
      })
    )
}
