import { computed, onScopeDispose, ref, watch, type Ref } from "vue"
import { useDebounceFn } from "@vueuse/core"
import type { PresetFilter, PresetRule } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { presetApi } from "@/entities/preset"
import { buildRule, type EditableFilter } from "./editable"
import { describePresetRule, presetFieldMeta } from "./fields"

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
  /** Сколько вакансий в корпусе без единого правила: начало санкея. */
  const total = ref<number | null>(null)
  const loading = ref(false)
  let generation = 0

  const plan = computed(() => {
    const rules: Array<{ id: number; rule: PresetRule }> = []
    for (const rule of state.value.rules) {
      const built = buildRule(rule)
      if (built !== null) rules.push({ id: rule.id, rule: built })
    }
    const steps: Array<{ id: number; filter: PresetFilter; base: PresetFilter }> = []
    const base = {
      ...(state.value.location === "any" ? {} : { location: state.value.location }),
      ...(state.value.keywordIds === undefined ? {} : { keywordIds: state.value.keywordIds })
    }
    const baseFilter = parsePresetFilter({ ...base, rules: [] })
    rules.forEach((entry, index) => {
      steps.push({
        id: entry.id,
        base: baseFilter,
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
        base: baseFilter,
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
    if (!enabled.value || steps.length < 1 || steps.length > MAX_STEPS) {
      counts.value = new Map()
      total.value = null
      loading.value = false
      return
    }
    loading.value = true
    try {
      const baseFilter = steps[0]!.base
      const [all, results] = await Promise.all([
        presetApi.preview(baseFilter).then((preview) => preview.count),
        Promise.all(
        steps.map(async (step): Promise<FunnelStep> => {
          const preview = await presetApi.preview(step.filter)
          return { id: step.id, count: preview.count }
        })
        )
      ])
      if (current !== generation) return
      total.value = all
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

  return { counts, total, loading }
}

export interface FunnelStage {
  readonly id: number
  readonly label: string
  readonly title: string
  readonly count: number
}

/** Этапы санкея: весь корпус, затем каждое посчитанное правило и группа по порядку. */
export const funnelStages = (
  state: EditableFilter,
  counts: ReadonlyMap<number, number>,
  total: number | null
): ReadonlyArray<FunnelStage> => {
  if (total === null) return []
  const stages: Array<FunnelStage> = [{ id: -1, label: "Корпус", title: "Весь корпус", count: total }]
  for (const rule of state.rules) {
    const count = counts.get(rule.id)
    const built = buildRule(rule)
    if (count === undefined || built === null) continue
    stages.push({ id: rule.id, label: presetFieldMeta(rule.field).label, title: describePresetRule(built), count })
  }
  for (const group of state.groups) {
    const count = counts.get(group.id)
    if (count !== undefined) stages.push({ id: group.id, label: "Группа «или»", title: "Любой из вариантов", count })
  }
  return stages
}
