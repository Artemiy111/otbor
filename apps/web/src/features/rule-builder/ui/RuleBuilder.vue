<script setup lang="ts">
import { computed, ref } from "vue"
import type { KeywordMatchLocation, PresetField } from "@otbor/contract"
import { Plus, X } from "@lucide/vue"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import { PRESET_LOCATION_OPTIONS, presetFieldMeta } from "../model/fields"
import { allRules, newBranch, newGroup, newRule, type EditableFilter } from "../model/editable"
import FieldPicker from "./FieldPicker.vue"
import RuleRow from "./RuleRow.vue"

/**
 * Compact rule constructor shared by presets and the vacancy list. Top-level
 * rules are ANDed. An "any of" group is OR over branches, and the rules inside
 * one branch are ANDed: `RUB >= 200k` / `USD >= 3k` is two branches.
 */
const props = withDefaults(
  defineProps<{
    disabled?: boolean
    flags?: boolean
    /** Воронка: id правила или группы → сколько вакансий остаётся после него. */
    counts?: ReadonlyMap<number, number>
  }>(),
  { disabled: false, flags: true, counts: undefined }
)

const state = defineModel<EditableFilter>({ required: true })

const hasKeywordRule = computed(() => allRules(state.value).some((rule) => rule.field === "keywords"))
const empty = computed(() => state.value.rules.length === 0 && state.value.groups.length === 0)

const QUICK_FIELDS: ReadonlyArray<PresetField> = ["title", "skills", "seniority", "work_format", "salary"]
const quickFields = computed(() => QUICK_FIELDS.map((field) => presetFieldMeta(field)))

/** Правило, которое пользователь только что добавил: его значение получает фокус. */
const freshId = ref<number | null>(null)

const addRule = (field: PresetField) => {
  const rule = newRule(field)
  freshId.value = rule.id
  state.value.rules.push(rule)
}

/** Перетаскивание порядка: правила верхнего уровня; порядок видно по воронке и в сохранённом фильтре. */
const dragId = ref<number | null>(null)
const overId = ref<number | null>(null)
const overAfter = ref(false)

const onDragStart = (id: number, event: DragEvent) => {
  dragId.value = id
  const row = (event.target as HTMLElement).closest("[data-rule-row]")
  if (row !== null && event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setDragImage(row, 16, 16)
  }
}
const onDragOver = (id: number, event: DragEvent) => {
  if (dragId.value === null) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  overId.value = id
  overAfter.value = event.clientY > box.top + box.height / 2
}
const endDrag = () => {
  dragId.value = null
  overId.value = null
}
const onDrop = () => {
  const from = dragId.value
  const target = overId.value
  const after = overAfter.value
  endDrag()
  if (from === null || target === null || from === target) return
  const moved = state.value.rules.find((rule) => rule.id === from)
  if (moved === undefined) return
  const rest = state.value.rules.filter((rule) => rule.id !== from)
  const at = rest.findIndex((rule) => rule.id === target) + (after ? 1 : 0)
  rest.splice(at, 0, moved)
  state.value.rules = rest
}

/** Сколько вакансий отсекло правило или группа относительно предыдущего шага. */
const orderedIds = computed(() => [...state.value.rules.map((rule) => rule.id), ...state.value.groups.map((group) => group.id)])
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
const removeRule = (id: number) => {
  state.value.rules = state.value.rules.filter((rule) => rule.id !== id)
}

const addGroup = () => {
  state.value.groups.push(newGroup())
}
const removeGroup = (id: number) => {
  state.value.groups = state.value.groups.filter((group) => group.id !== id)
}
const removeBranch = (groupId: number, branchId: number) => {
  const group = state.value.groups.find((item) => item.id === groupId)
  if (group === undefined) return
  group.branches = group.branches.filter((branch) => branch.id !== branchId)
  if (group.branches.length === 0) removeGroup(groupId)
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
const removeBranchRule = (groupId: number, branchId: number, ruleId: number) => {
  const branch = state.value.groups
    .find((item) => item.id === groupId)
    ?.branches.find((item) => item.id === branchId)
  if (branch === undefined) return
  branch.rules = branch.rules.filter((rule) => rule.id !== ruleId)
  if (branch.rules.length === 0) removeBranch(groupId, branchId)
}

const onLocation = (value: unknown) => {
  const next = value as KeywordMatchLocation
  state.value.location = PRESET_LOCATION_OPTIONS.some((option) => option.value === next) ? next : "any"
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-if="props.counts !== undefined && state.rules.length + state.groups.length > 1"
      class="flex justify-end gap-2 pr-9 text-xs uppercase tracking-[0.06em] text-muted-foreground"
      title="Счёт идёт сверху вниз: сколько вакансий отсекло правило и сколько осталось после него"
    >
      осталось
    </div>
    <div v-if="state.rules.length > 0" class="space-y-1">
      <div
        v-for="rule in state.rules"
        :key="rule.id"
        class="rounded-sm border-y-2 border-transparent"
        :class="
          dragId !== null && overId === rule.id && dragId !== rule.id
            ? overAfter
              ? 'border-b-primary'
              : 'border-t-primary'
            : ''
        "
        @dragover="onDragOver(rule.id, $event)"
        @drop.prevent="onDrop"
      >
        <RuleRow
          :rule="rule"
          :disabled="props.disabled"
          :count="stepOf(rule.id)?.count"
          :dropped="stepOf(rule.id)?.dropped"
          :show-count="props.counts !== undefined"
          :sortable="state.rules.length > 1"
          :autofocus="rule.id === freshId"
          :class="dragId === rule.id ? 'opacity-40' : ''"
          @dragstart="onDragStart(rule.id, $event)"
          @dragend="endDrag"
          @remove="removeRule(rule.id)"
        />
      </div>
    </div>

    <div
      v-for="group in state.groups"
      :key="group.id"
      class="space-y-1.5 border-l-2 border-l-ai/70 pl-2"
    >
      <p class="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
        Любой из вариантов
        <span
          v-if="stepOf(group.id)"
          class="ml-auto pr-9 font-normal normal-case tracking-normal tabular-nums text-foreground/80"
          :title="`Отсекла ${stepOf(group.id)!.dropped.toLocaleString('ru-RU')}`"
        >
          {{ stepOf(group.id)!.count.toLocaleString("ru-RU") }}
        </span>
      </p>
      <template v-for="(branch, index) in group.branches" :key="branch.id">
        <div v-if="index > 0" class="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
          или<span class="h-px flex-1 bg-border" />
        </div>
        <RuleRow
          v-for="rule in branch.rules"
          :key="rule.id"
          :rule="rule"
          :disabled="props.disabled"
          @remove="removeBranchRule(group.id, branch.id, rule.id)"
        />
        <FieldPicker
          label="и"
          :disabled="props.disabled"
          @pick="(field) => addBranchRule(group.id, branch.id, field)"
        />
      </template>

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          :disabled="props.disabled"
          @click="addBranch(group.id)"
        >
          <Plus class="h-3.5 w-3.5" />
          или
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Удалить группу"
          :disabled="props.disabled"
          @click="removeGroup(group.id)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <FieldPicker :disabled="props.disabled" @pick="addRule" />

      <button
        type="button"
        class="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        title="Вакансия проходит, если выполнен любой из вариантов, например зарплата в рублях или в долларах"
        :disabled="props.disabled"
        @click="addGroup"
      >
        <Plus class="h-3.5 w-3.5" />
        Группа «или»
      </button>

      <template v-if="empty">
        <button
          v-for="m in quickFields"
          :key="m.field"
          type="button"
          class="inline-flex h-7 items-center rounded-full border border-border px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          :disabled="props.disabled"
          @click="addRule(m.field)"
        >
          {{ m.label }}
        </button>
      </template>

      <template v-if="props.flags">
        <span v-if="hasKeywordRule" class="mx-1 hidden h-4 w-px bg-border sm:block" />
        <Select v-if="hasKeywordRule" :model-value="state.location" :disabled="props.disabled" @update:model-value="onLocation">
          <SelectTrigger class="h-7 w-[170px] text-xs" title="Где искать ключевые слова">
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
