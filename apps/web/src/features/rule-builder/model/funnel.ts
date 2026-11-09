import { computed, onScopeDispose, ref, watch, type Ref } from "vue"
import { useDebounceFn } from "@vueuse/core"
import type { PresetFilter, PresetRule } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { presetApi } from "@/entities/preset"
import { buildRule, type EditableFilter } from "./editable"

/** Сколько шагов воронки считаем: каждый шаг это отдельный запрос предпросмотра. */
const MAX_STEPS = 12

export interface FunnelStep {
  /** id правила (или группы) в редакторе. */
  readonly id: number
  /** Сколько вакансий остаётся после этого шага. */
  readonly count: number
}

/**
 * Воронка: сколько вакансий остаётся после каждого правила по порядку. Верхние
 * правила идут «и», затем группы «или». Неполные правила пропускаются, как и при
 * сохранении. Считается с паузой и отбрасывает устаревшие ответы.
 */
export const useRuleFunnel = (state: Ref<EditableFilter>, enabled: Ref<boolean> = ref(true)) => {
  const counts = ref<ReadonlyMap<number, number>>(new Map())
  const loading = ref(false)
  let generation = 0

  const plan = computed(() => {
    const rules: Array<{ id: number; rule: PresetRule }> = []
    for (const rule of state.value.rules) {
      const built = buildRule(rule)
      if (built !== null) rules.push({ id: rule.id, rule: built })
    }
    const steps: Array<{ id: number; filter: PresetFilter }> = []
    const base = {
      ...(state.value.location === "any" ? {} : { location: state.value.location }),
      ...(state.value.keywordIds === undefined ? {} : { keywordIds: state.value.keywordIds })
    }
    rules.forEach((entry, index) => {
      steps.push({
        id: entry.id,
        filter: parsePresetFilter({ ...base, rules: rules.slice(0, index + 1).map((item) => item.rule) })
      })
    })
    const all = rules.map((item) => item.rule)
    const groups: Array<{ id: number; branches: Array<{ rules: Array<PresetRule> }> }> = []
    for (const group of state.value.groups) {
      const branches = group.branches
        .map((branch) => ({
          rules: branch.rules.map(buildRule).filter((rule): rule is PresetRule => rule !== null)
        }))
        .filter((branch) => branch.rules.length > 0)
      if (branches.length === 0) continue
      groups.push({ id: group.id, branches })
      steps.push({
        id: group.id,
        filter: parsePresetFilter({
          ...base,
          rules: all,
          groups: groups.map(({ branches: kept }) => ({ branches: kept }))
        })
      })
    }
    return steps
  })

  const run = async () => {
    const steps = plan.value
    const current = ++generation
    // Одно правило даёт тот же счёт, что и общий предпросмотр: воронка бесполезна.
    if (!enabled.value || steps.length < 2 || steps.length > MAX_STEPS) {
      counts.value = new Map()
      loading.value = false
      return
    }
    loading.value = true
    try {
      const results = await Promise.all(
        steps.map(async (step): Promise<FunnelStep> => {
          const preview = await presetApi.preview(step.filter)
          return { id: step.id, count: preview.count }
        })
      )
      if (current !== generation) return
      counts.value = new Map(results.map((item) => [item.id, item.count]))
    } catch {
      if (current === generation) counts.value = new Map()
    } finally {
      if (current === generation) loading.value = false
    }
  }

  const schedule = useDebounceFn(run, 700)

  watch(
    () => JSON.stringify(plan.value.map((step) => step.filter)),
    () => void schedule(),
    { immediate: true }
  )
  onScopeDispose(() => {
    generation++
  })

  return { counts, loading }
}
