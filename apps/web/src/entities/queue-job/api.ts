import type { HarnessJob, QueueStats } from "@otbor/contract"
import { call } from "@/shared/api"

export interface QueueJobListInput {
  readonly status?: string
  readonly limit?: number
}

export const queueJobApi = {
  stats: (): Promise<QueueStats> => call((client) => client.QueueStatsGet()),
  list: (input: QueueJobListInput): Promise<ReadonlyArray<HarnessJob>> =>
    call((client) => client.QueueJobsList(input))
}
