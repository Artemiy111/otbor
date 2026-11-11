import type {
  ApplyFilterRecord,
  ApplyUsage,
  ApplyFilterView,
  HhAccountId,
  PresetId,
  ResumeId
} from "@otbor/contract"
import { call } from "@/shared/api"
import {
  buildAutoSavePayload,
  buildRulesSavePayload,
  type ApplyFilterSavePayload,
  type AutoSettingsValues,
  type RulesValues
} from "./merge"

export interface ApplyFilterTarget {
  readonly hhAccountId: string
  /** Omitted or null: the account-level row. */
  readonly resumeId?: string | null
}

export interface ApplyFilterFromPresetInput extends ApplyFilterTarget {
  readonly presetId: string
}

const target = (input: ApplyFilterTarget) => ({
  hhAccountId: input.hhAccountId as HhAccountId,
  resumeId: (input.resumeId ?? undefined) as ResumeId | undefined
})

const send = (payload: ApplyFilterSavePayload): Promise<ApplyFilterRecord> =>
  call((client) =>
    client.ApplyFilterSet({
      ...target(payload),
      filter: payload.filter,
      minFit: payload.minFit,
      tests: payload.tests,
      freshHalfLifeHours: payload.freshHalfLifeHours,
      templatePresetId: payload.templatePresetId as PresetId | null | undefined,
      autoMode: payload.autoMode,
      dailyLimit: payload.dailyLimit,
      batchSize: payload.batchSize,
      sort: payload.sort,
      sortDirection: payload.sortDirection,
      minPriority: payload.minPriority,
      requireLetter: payload.requireLetter,
      boosts: payload.boosts,
      writingHarness: payload.writingHarness,
      writingModel: payload.writingModel,
      writingEffort: payload.writingEffort
    })
  )

export const applyFilterApi = {
  get: (input: ApplyFilterTarget): Promise<ApplyFilterView> =>
    call((client) => client.ApplyFilterGet(target(input))),
  /**
   * Правила отбора. Перед записью читается свежий фильтр пары: чужая половина
   * (настройки автооткликов) собирается из него, а не из кэша формы.
   */
  saveRules: async (target: ApplyFilterTarget, values: RulesValues): Promise<ApplyFilterRecord> => {
    const fresh = await applyFilterApi.get(target)
    return send(buildRulesSavePayload(fresh, target, values))
  },
  /** Настройки автооткликов; фильтр и правила берутся из свежего ответа сервера. */
  saveAuto: async (target: ApplyFilterTarget, values: AutoSettingsValues): Promise<ApplyFilterRecord> => {
    const fresh = await applyFilterApi.get(target)
    return send(buildAutoSavePayload(fresh, target, values))
  },
  usage: (hhAccountId: string): Promise<ApplyUsage> =>
    call((client) => client.ApplyUsageGet({ hhAccountId: hhAccountId as HhAccountId })),
  fromPreset: (input: ApplyFilterFromPresetInput): Promise<ApplyFilterRecord> =>
    call((client) =>
      client.ApplyFilterFromPreset({ ...target(input), presetId: input.presetId as PresetId })
    )
}
