import { computed, onScopeDispose, ref, watch, type Ref } from "vue"
import { useDebounceFn } from "@vueuse/core"
import type { PresetFilter, PresetRule } from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { presetApi } from "@/entities/preset"
import { buildRule, orderedIdsOf, type EditableFilter } from "./editable"
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
    const byId = new Map<number, PresetRule | Array<{ rules: Array<PresetRule> }>>()
    for (const rule of state.value.rules) {
      const built = buildRule(rule)
      if (built !== null) byId.set(rule.id, built)
    }
    for (const group of state.value.groups) {
      const branches = group.branches
        .map((branch) => ({
          rules: branch.rules.map(buildRule).filter((rule): rule is PresetRule => rule !== null)
        }))
        .filter((branch) => branch.rules.length > 0)
      if (branches.length > 0) byId.set(group.id, branches)
    }

    const base = {
      ...(state.value.location === "any" ? {} : { location: state.value.location }),
      ...(state.value.keywordIds === undefined ? {} : { keywordIds: state.value.keywordIds })
    }
    const baseFilter = parsePresetFilter({ ...base, rules: [] })
    const steps: Array<{ id: number; filter: PresetFilter; base: PresetFilter }> = []
    const rules: Array<PresetRule> = []
    const groups: Array<{ id: number; branches: Array<{ rules: Array<PresetRule> }> }> = []

    // Шаги идут в сохранённом порядке блоков, а не «все правила, потом группы».
    for (const id of orderedIdsOf(state.value)) {
      const item = byId.get(id)
      if (item === undefined) continue
      if (Array.isArray(item)) groups.push({ id, branches: item })
      else rules.push(item)
      steps.push({
        id,
        base: baseFilter,
        filter: parsePresetFilter({
          ...base,
          rules,
          groups: groups.map(({ id: groupId, branches }) => ({ id: groupId, branches }))
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
  const rules = new Map(state.rules.map((rule) => [rule.id, rule]))
  const groups = new Map(state.groups.map((group) => [group.id, group]))
  for (const id of orderedIdsOf(state)) {
    const count = counts.get(id)
    if (count === undefined) continue
    const rule = rules.get(id)
    const group = groups.get(id)
    if (rule !== undefined) {
      const built = buildRule(rule)
      if (built === null) continue
      stages.push({ id, label: presetFieldMeta(rule.field).label, title: describePresetRule(built), count })
    } else if (group !== undefined) {
      stages.push({ id, label: "Группа «или»", title: "Любой из вариантов", count })
    }
  }
  return stages
}
