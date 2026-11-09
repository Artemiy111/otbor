import type {
  CaptchaSolverSettings,
  CaptchaSolverTestResult,
  LocalModelHealth,
  LocalModelInput,
  LocalModelServer
} from "@otbor/contract"
import { call } from "@/shared/api"

export const localModelApi = {
  list: (): Promise<ReadonlyArray<LocalModelServer>> => call((client) => client.LocalModelsList()),
  check: (): Promise<ReadonlyArray<LocalModelHealth>> => call((client) => client.LocalModelsCheck()),
  upsert: (input: LocalModelInput): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelUpsert(input)),
  remove: (id: string): Promise<ReadonlyArray<LocalModelServer>> =>
    call((client) => client.LocalModelRemove({ id })),
  captchaGet: (): Promise<CaptchaSolverSettings> => call((client) => client.CaptchaSolverGet()),
  captchaSet: (input: CaptchaSolverSettings): Promise<CaptchaSolverSettings> =>
    call((client) => client.CaptchaSolverSet(input)),
  captchaTest: (): Promise<CaptchaSolverTestResult> => call((client) => client.CaptchaSolverTest())
}
