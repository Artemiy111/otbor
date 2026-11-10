import { computed, reactive, ref } from "vue"
import type { ApplyFilterView, ApplySort, AutoMode, SortDirection } from "@otbor/contract"
import {
  isDirty,
  settingsKey,
  settingsOf,
  validateAutoSettings,
  type AutoSettingsValues
} from "@/entities/apply-filter"
import { buildRule, isComplete, newRule, toEditableRule, type EditableRule } from "@/features/rule-builder"

export interface BoostRow {
  readonly id: number
  rule: EditableRule
  weight: number
}

type LoadSource = Parameters<typeof settingsOf>[0]

let boostSequence = 0

/**
 * Черновик формы настроек автооткликов: поля, перевод в значения для
 * сохранения и признак несохранённых правок. Сравнение идёт с ключом,
 * снятым в момент загрузки тем же кодом, что строит текущее значение.
 */
export const useAutoDraft = () => {
  const mode = ref<AutoMode>("off")
  const dailyLimit = ref(200)
  const batchSize = ref(20)
  const sort = ref<ApplySort>("priority")
  const sortDirection = ref<SortDirection>("desc")
  const minPriority = ref(0)
  const writingHarness = ref("")
  const writingModel = ref("")
  const writingEffort = ref("")
  const boosts = ref<Array<BoostRow>>([])

  const incompleteBoosts = computed(() => boosts.value.some((boost) => !isComplete(boost.rule)))

  const values = computed<AutoSettingsValues>(() => ({
    autoMode: mode.value,
    dailyLimit: dailyLimit.value,
    batchSize: batchSize.value,
    sort: sort.value,
    sortDirection: sortDirection.value,
    minPriority: minPriority.value,
    writingHarness: writingHarness.value,
    writingModel: writingModel.value,
    writingEffort: writingEffort.value,
    boosts: boosts.value.flatMap((boost) => {
      const rule = buildRule(boost.rule)
      return rule === null ? [] : [{ rule, weight: boost.weight }]
    })
  }))

  const loadedKey = ref<string | null>(null)
  let lastSource: LoadSource | null = null

  const load = (source: LoadSource) => {
    lastSource = source
    const next = settingsOf(source)
    mode.value = next.autoMode
    dailyLimit.value = next.dailyLimit
    batchSize.value = next.batchSize
    sort.value = next.sort
    sortDirection.value = next.sortDirection
    minPriority.value = next.minPriority
    writingHarness.value = next.writingHarness
    writingModel.value = next.writingModel
    writingEffort.value = next.writingEffort
    boosts.value = next.boosts.map((boost) => ({
      id: boostSequence++,
      rule: reactive(toEditableRule(boost.rule)),
      weight: boost.weight
    }))
    loadedKey.value = settingsKey(values.value)
  }

  const reset = () => {
    if (lastSource !== null) load(lastSource)
  }

  const dirty = computed(() => isDirty(loadedKey.value, settingsKey(values.value), incompleteBoosts.value))
  const error = computed(() => validateAutoSettings(values.value, incompleteBoosts.value))

  const addBoost = (field: Parameters<typeof newRule>[0]) => {
    boosts.value.push({ id: boostSequence++, rule: reactive(newRule(field)), weight: 5 })
  }
  const removeBoost = (id: number) => {
    boosts.value = boosts.value.filter((boost) => boost.id !== id)
  }

  return {
    mode,
    dailyLimit,
    batchSize,
    sort,
    sortDirection,
    minPriority,
    writingHarness,
    writingModel,
    writingEffort,
    boosts,
    values,
    incompleteBoosts,
    dirty,
    error,
    load,
    reset,
    addBoost,
    removeBoost
  }
}

export type AutoDraft = ReturnType<typeof useAutoDraft>

/** Загруженное состояние относится к выбранной паре (а не к предыдущей). */
export const viewMatches = (view: ApplyFilterView | null, accountId: string, resumeId: string | null): boolean =>
  view !== null && view.hhAccountId === accountId && (view.resumeId ?? null) === resumeId
