import type { LocalModelHealth, LocalModelInput, LocalModelServer } from "@otbor/contract"
import { call } from "@/shared/api"

export const localModelApi = {
  list: (): Promise<ReadonlyArray<LocalModelServer>> => call((client) => client.LocalModelsList()),
  check: (): Promise<ReadonlyArray<LocalModelHealth>> => call((client) => client.LocalModelsCheck()),
  upsert: (input: LocalModelInput): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelUpsert(input)),
  remove: (id: string): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelRemove({ id }))
}
