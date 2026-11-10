import type { Overview } from "@otbor/contract"
import { call } from "@/shared/api"

export const overviewApi = {
  /** Снимок «что сейчас делает вся система» за окно из `days` суток. */
  get: (days: number): Promise<Overview> => call((client) => client.OverviewGet({ days }))
}
