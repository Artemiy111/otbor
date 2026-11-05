import type {
  ApplyFilterRecord,
  ApplyFilterView,
  HhAccountId,
  PresetFilter,
  PresetId,
  ResumeId,
  TestsPolicy
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface ApplyFilterTarget {
  readonly hhAccountId: string
  /** Omitted or null: the account-level row. */
  readonly resumeId?: string | null
}

export interface ApplyFilterSetInput extends ApplyFilterTarget {
  readonly filter: PresetFilter
  readonly minFit: number
  readonly tests: TestsPolicy
  readonly freshHalfLifeHours: number
}

export interface ApplyFilterFromPresetInput extends ApplyFilterTarget {
  readonly presetId: string
}

const target = (input: ApplyFilterTarget) => ({
  hhAccountId: input.hhAccountId as HhAccountId,
  resumeId: (input.resumeId ?? undefined) as ResumeId | undefined
})

export const applyFilterApi = {
  get: (input: ApplyFilterTarget): Promise<ApplyFilterView> =>
    call((client) => client.ApplyFilterGet(target(input))),
  set: (input: ApplyFilterSetInput): Promise<ApplyFilterRecord> =>
    call((client) =>
      client.ApplyFilterSet({
        ...target(input),
        filter: input.filter,
        minFit: input.minFit,
        tests: input.tests,
        freshHalfLifeHours: input.freshHalfLifeHours
      })
    ),
  fromPreset: (input: ApplyFilterFromPresetInput): Promise<ApplyFilterRecord> =>
    call((client) =>
      client.ApplyFilterFromPreset({ ...target(input), presetId: input.presetId as PresetId })
    )
}
