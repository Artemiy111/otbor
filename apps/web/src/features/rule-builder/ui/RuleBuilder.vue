<script setup lang="ts">
import { computed, ref } from "vue"
import type { KeywordMatchLocation, PresetField } from "@otbor/contract"
import { GripVertical, Plus, X } from "@lucide/vue"
import { PRESET_LOCATION_OPTIONS, presetFieldMeta } from "../model/fields"
import {
  allRules,
  newBranch,
  newGroup,
  newRule,
  type EditableFilter,
  type EditableGroup,
  type EditableRule
} from "../model/editable"
import FieldPicker from "./FieldPicker.vue"
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import { useDragReorder } from "../model/use-drag"
import FilterRow from "./FilterRow.vue"

/**
 * Блок фильтров. Правила и группы «или» живут в одном упорядоченном списке,
 * поэтому группу можно перетащить на любое место среди правил.
 */
type BlockItem =
  | { readonly id: number; readonly kind: "rule"; readonly rule: EditableRule }
  | { readonly id: number; readonly kind: "group"; readonly group: EditableGroup }

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    flags?: boolean
    counts?: ReadonlyMap<number, number>
  }>(),
  { disabled: false, flags: true, counts: undefined }
)

const state = defineModel<EditableFilter>({ required: true })

const hasKeywordRule = computed(() => allRules(state.value).some((rule) => rule.field === "keywords"))
const empty = computed(() => state.value.rules.length === 0 && state.value.groups.length === 0)
const QUICK_FIELDS: ReadonlyArray<PresetField> = ["title", "skills", "seniority", "work_format", "salary"]
const quickFields = computed(() => QUICK_FIELDS.map((field) => presetFieldMeta(field)))

const freshId = ref<number | null>(null)

/** Порядок из состояния плюс новые элементы и минус исчезнувшие. */
const orderedIds = computed(() => {
  const ids = [...state.value.rules.map((rule) => rule.id), ...state.value.groups.map((group) => group.id)]
  const known = new Set(ids)
  const saved = (state.value.order ?? []).filter((id) => known.has(id))
  return [...saved, ...ids.filter((id) => !saved.includes(id))]
})

const items = computed<ReadonlyArray<BlockItem>>(() => {
  const rules = new Map(state.value.rules.map((rule) => [rule.id, rule]))
  const groups = new Map(state.value.groups.map((group) => [group.id, group]))
  return orderedIds.value.flatMap((id): Array<BlockItem> => {
    const rule = rules.get(id)
    if (rule !== undefined) return [{ id, kind: "rule", rule }]
    const group = groups.get(id)
    if (group !== undefined) return [{ id, kind: "group", group }]
    return []
  })
})

const drag = useDragReorder(() => items.value)
const drop = () => {
  const next = drag.drop()
  if (next !== undefined) state.value.order = next.map((item) => item.id)
}

const addRule = (field: PresetField) => {
  const rule = newRule(field)
  freshId.value = rule.id
  state.value.rules.push(rule)
  state.value.order = [...orderedIds.value, rule.id]
}
const addGroup = () => {
  const group = newGroup()
  state.value.groups.push(group)
  state.value.order = [...orderedIds.value, group.id]
}
const addBranch = (groupId: number) => {
  state.value.groups.find((item) => item.id === groupId)?.branches.push(newBranch())
}
const addBranchRule = (groupId: number, branchId: number, field: PresetField) => {
  state.value.groups
    .find((item) => item.id === groupId)
    ?.branches.find((branch) => branch.id === branchId)
    ?.rules.push(newRule(field))
}

const removeRule = (id: number) => {
  if (state.value.rules.find((item) => item.id === id)?.locked === true) return
  state.value.rules = state.value.rules.filter((item) => item.id !== id)
  state.value.order = orderedIds.value.filter((item) => item !== id)
}
const removeGroup = (id: number) => {
  state.value.groups = state.value.groups.filter((group) => group.id !== id)
  state.value.order = orderedIds.value.filter((item) => item !== id)
}
const removeBranchRule = (groupId: number, branchId: number, ruleId: number) => {
  const branch = state.value.groups
    .find((item) => item.id === groupId)
    ?.branches.find((item) => item.id === branchId)
  if (branch === undefined) return
  branch.rules = branch.rules.filter((rule) => rule.id !== ruleId)
  if (branch.rules.length === 0) removeBranch(groupId, branchId)
}
const removeBranch = (groupId: number, branchId: number) => {
  const group = state.value.groups.find((item) => item.id === groupId)
  if (group === undefined) return
  group.branches = group.branches.filter((branch) => branch.id !== branchId)
  if (group.branches.length === 0) removeGroup(groupId)
}

const onLocation = (value: unknown) => {
  const next = value as KeywordMatchLocation
  state.value.location = PRESET_LOCATION_OPTIONS.some((option) => option.value === next) ? next : "any"
}

const stepOf = (id: number): { count: number; dropped: number } | undefined => {
  const count = props.counts?.get(id)
  if (count === undefined) return undefined
  const index = orderedIds.value.indexOf(id)
  const previous = orderedIds.value
    .slice(0, index)
    .reverse()
    .map((item) => props.counts?.get(item))
    .find((value) => value !== undefined)
  return { count, dropped: previous === undefined ? 0 : Math.max(0, previous - count) }
}
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-if="props.counts !== undefined && items.length > 1"
      class="pr-8 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
      title="Счёт идёт сверху вниз: сколько вакансий отсекло правило и сколько осталось"
    >
      осталось
    </div>

    <template v-for="item in items" :key="item.id">
      <div
        v-if="item.kind === 'rule'"
        data-filter-row
        class="relative flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-accent/40"
        :class="drag.dragId.value === item.id ? 'opacity-40' : ''"
        @dragover="drag.over(item.id, $event)"
        @drop.prevent="drop"
      >
        <FilterRow
          :rule="item.rule"
          :disabled="props.disabled"
          :count="stepOf(item.id)?.count"
          :dropped="stepOf(item.id)?.dropped"
          :show-count="props.counts !== undefined"
          :sortable="items.length > 1"
          :locked="item.rule.locked === true"
          :autofocus="item.id === freshId"
          @dragstart="drag.start(item.id, $event)"
          @dragend="drag.end"
          @remove="removeRule(item.id)"
        />
        <div
          v-if="drag.overId.value === item.id && drag.dragId.value !== item.id"
          class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary"
          :class="drag.overAfter.value ? 'bottom-0' : 'top-0'"
        />
      </div>

      <div
        v-else
        data-filter-row
        class="relative flex items-start gap-1 rounded-lg border border-border/80 bg-muted/10 py-1 pl-1 pr-2"
        :class="drag.dragId.value === item.id ? 'opacity-40' : ''"
        @dragover="drag.over(item.id, $event)"
        @drop.prevent="drop"
      >
        <button
          type="button"
          draggable="true"
          class="-ml-0.5 mt-0.5 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
          title="Перетащите блок «или»"
          tabindex="-1"
          :disabled="props.disabled"
          @dragstart="drag.start(item.id, $event)"
          @dragend="drag.end"
        >
          <GripVertical class="size-3.5" />
        </button>

        <div class="min-w-0 flex-1 space-y-0.5">
          <template v-for="(branch, index) in item.group.branches" :key="branch.id">
            <div
              v-if="index > 0"
              class="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"
            >
              или<span class="h-px flex-1 bg-border" />
            </div>
            <FilterRow
              v-for="rule in branch.rules"
              :key="rule.id"
              :rule="rule"
              :disabled="props.disabled"
              @remove="removeBranchRule(item.id, branch.id, rule.id)"
            />
            <FieldPicker
              compact
              label="и"
              :disabled="props.disabled"
              @pick="(field) => addBranchRule(item.id, branch.id, field)"
            />
          </template>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-1.5 text-[11px] text-muted-foreground"
            :disabled="props.disabled"
            @click="addBranch(item.id)"
          >
            <Plus class="size-3" />
            или
          </Button>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-0.5">
          <span
            v-if="stepOf(item.id)"
            class="text-[11px] tabular-nums text-muted-foreground"
            :title="`Отсекла ${stepOf(item.id)!.dropped.toLocaleString('ru-RU')}`"
          >
            {{ stepOf(item.id)!.count.toLocaleString("ru-RU") }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            class="size-5 p-0 text-muted-foreground hover:text-destructive"
            title="Удалить группу"
            :disabled="props.disabled"
            @click="removeGroup(item.id)"
          >
            <X class="size-3.5" />
          </Button>
        </div>

        <div
          v-if="drag.overId.value === item.id && drag.dragId.value !== item.id"
          class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary"
          :class="drag.overAfter.value ? 'bottom-0' : 'top-0'"
        />
      </div>
    </template>

    <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed px-2 py-1.5">
      <FieldPicker compact :disabled="props.disabled" @pick="addRule" />
      <Button
        variant="outline"
        size="sm"
        class="h-7 px-2 text-xs text-muted-foreground"
        title="Вакансия проходит, если выполнен любой из вариантов"
        :disabled="props.disabled"
        @click="addGroup"
      >
        <Plus class="size-3.5" />
        Группа «или»
      </Button>

      <template v-if="empty">
        <span class="mx-0.5 hidden h-4 w-px bg-border sm:block" />
        <Button
          v-for="m in quickFields"
          :key="m.field"
          variant="outline"
          size="sm"
          class="h-6 rounded-full px-2.5 text-[11px] font-normal text-muted-foreground"
          :disabled="props.disabled"
          @click="addRule(m.field)"
        >
          {{ m.label }}
        </Button>
      </template>

      <template v-if="props.flags && hasKeywordRule">
        <span class="mx-0.5 hidden h-4 w-px bg-border sm:block" />
        <Select :model-value="state.location" :disabled="props.disabled" @update:model-value="onLocation">
          <SelectTrigger class="h-7 w-[150px] text-xs" title="Где искать ключевые слова">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in PRESET_LOCATION_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </template>
    </div>
  </div>
</template>
