import type { PresetFilter, PresetId, PresetRecord } from "@otbor/contract"
import { call } from "@/shared/api"

export interface PresetListInput {
  readonly kind?: string
}

export interface PresetUpsertInput {
  readonly id?: string
  readonly kind: "explore" | "apply"
  readonly title: string
  readonly filter?: PresetFilter
}

export interface PresetRemoveResult {
  readonly id: PresetId
  readonly deleted: boolean
}

export const presetApi = {
  list: (input: PresetListInput): Promise<ReadonlyArray<PresetRecord>> =>
    call((client) => client.PresetsList(input)),
  upsert: (input: PresetUpsertInput): Promise<PresetRecord> =>
    call((client) => client.PresetsUpsert(input)),
  remove: (id: string): Promise<PresetRemoveResult> =>
    call((client) => client.PresetsRemove({ id: id as PresetId }))
}
