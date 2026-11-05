import type { HarnessJob, QueueStats } from "@otbor/contract"
import { call } from "@/shared/api"

export interface QueueJobListInput {
  readonly status?: string
  readonly kind?: "browser" | "inference"
  readonly limit?: number
}

export const queueJobApi = {
  stats: (kind?: "browser" | "inference"): Promise<QueueStats> =>
    call((client) => client.QueueStatsGet({ kind })),
  list: (input: QueueJobListInput): Promise<ReadonlyArray<HarnessJob>> =>
    call((client) => client.QueueJobsList(input))
}
