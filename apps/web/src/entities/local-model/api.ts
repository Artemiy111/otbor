import type { LocalModelInput, LocalModelServer } from "@otbor/contract"
import { call } from "@/shared/api"

export const localModelApi = {
  list: (): Promise<ReadonlyArray<LocalModelServer>> => call((client) => client.LocalModelsList()),
  upsert: (input: LocalModelInput): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelUpsert(input)),
  remove: (id: string): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelRemove({ id }))
}
