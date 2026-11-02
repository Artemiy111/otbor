import type { CrawlSchedule, ScheduleId, SourceSyncKind } from "@otbor/contract"
import { call } from "@/shared/api"

export interface ScheduleUpsertInput {
  readonly id?: string
  readonly kind?: SourceSyncKind
  readonly targetId: string
  readonly intervalMinutes: number
  readonly enabled?: boolean
  readonly options?: Record<string, unknown>
}

export interface ScheduleRemoveResult {
  readonly id: ScheduleId
  readonly deleted: boolean
}

export interface ScheduleRunNowResult {
  readonly accepted: boolean
  readonly schedule: CrawlSchedule
}

export const scheduleApi = {
  list: (): Promise<ReadonlyArray<CrawlSchedule>> =>
    call((client) => client.SchedulesList()),
  upsert: (input: ScheduleUpsertInput): Promise<CrawlSchedule> =>
    call((client) =>
      client.ScheduleUpsert({
        ...input,
        id: input.id as ScheduleId | undefined
      })
    ),
  remove: (id: string): Promise<ScheduleRemoveResult> =>
    call((client) => client.ScheduleRemove({ id: id as ScheduleId })),
  runNow: (id: string): Promise<ScheduleRunNowResult> =>
    call((client) => client.ScheduleRunNow({ id: id as ScheduleId }))
}
