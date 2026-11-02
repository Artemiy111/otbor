import type { ScheduleId, ScheduleRun } from "@otbor/contract"
import { call } from "@/shared/api"

export interface ScheduleRunListInput {
  readonly scheduleId?: string
  readonly kind?: string
  readonly limit?: number
  readonly offset?: number
}

export interface ScheduleRunListResult {
  readonly items: ReadonlyArray<ScheduleRun>
  readonly total: number
}

export const scheduleRunApi = {
  list: (input: ScheduleRunListInput): Promise<ScheduleRunListResult> =>
    call((client) =>
      client.ScheduleRunsList({
        scheduleId: input.scheduleId as ScheduleId | undefined,
        kind: input.kind as any,
        limit: input.limit,
        offset: input.offset
      })
    )
}
