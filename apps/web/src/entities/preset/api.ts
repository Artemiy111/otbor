import type { PresetRecord } from "@otbor/contract"
import { call } from "@/shared/api"

export interface PresetListInput {
  readonly kind?: string
}

export const presetApi = {
  list: (input: PresetListInput): Promise<ReadonlyArray<PresetRecord>> =>
    call((client) => client.PresetsList(input))
}
