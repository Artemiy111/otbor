<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { KeywordMatchLocation, PresetField, PresetOperator } from "@otbor/contract"
import { ChevronDown, Plus, Search, X } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"
import {
  PRESET_FIELD_GROUPS,
  PRESET_LOCATION_OPTIONS,
  isMultiValueOperator,
  presetFieldMeta,
  presetOperatorLabel
} from "../model/fields"
import {
  changeField,
  changeOperator,
  isComplete,
  newRule,
  usesList,
  type EditableFilter,
  type EditableRule
} from "../model/editable"
import KeywordPicker from "./KeywordPicker.vue"

/**
 * Compact rule constructor shared by presets and the vacancy list. A rule is
 * one line: field, operator, value. The state object is edited in place.
 */
const props = withDefaults(defineProps<{ disabled?: boolean; flags?: boolean }>(), {
  disabled: false,
  flags: true
})

const state = defineModel<EditableFilter>({ required: true })

const lexiconQuery = useQuery({
  key: () => keywordKeys.list(""),
  query: () => keywordApi.list({ limit: 5000 }),
  // The dictionary is only needed once a keyword rule exists.
  enabled: () => state.value.rules.some((rule) => rule.field === "keywords")
})
const lexicon = computed(() => lexiconQuery.data.value ?? [])

const hasKeywordRule = computed(() => state.value.rules.some((rule) => rule.field === "keywords"))

/* Adding ------------------------------------------------------------------ */

const addOpen = ref(false)
const addSearch = ref("")

const addGroups = computed(() => {
  const needle = addSearch.value.trim().toLocaleLowerCase("ru-RU")
  return PRESET_FIELD_GROUPS.map((group) => ({
    group: group.group,
    fields: group.fields.filter(
      (meta) => needle === "" || meta.label.toLocaleLowerCase("ru-RU").includes(needle)
    )
  })).filter((group) => group.fields.length > 0)
})

const addRule = (field: PresetField) => {
  state.value.rules.push(newRule(field))
  addOpen.value = false
  addSearch.value = ""
}

/** The usual starting points, one click each. */
const QUICK_FIELDS: ReadonlyArray<PresetField> = ["title", "skills", "seniority", "work_format", "salary_from"]
const quickFields = computed(() => QUICK_FIELDS.map((field) => presetFieldMeta(field)))

const removeRule = (id: number) => {
  state.value.rules = state.value.rules.filter((rule) => rule.id !== id)
}

/* Value controls ---------------------------------------------------------- */

const meta = (rule: EditableRule) => presetFieldMeta(rule.field)

const optionsFor = (rule: EditableRule) => {
  const base = [...(meta(rule).options ?? [])]
  const known = new Set(base.map((option) => option.value))
  for (const value of [rule.text, ...rule.values]) {
    if (value !== "" && !known.has(value)) {
      base.push({ value, label: value })
      known.add(value)
    }
  }
  return base
}

const listSummary = (rule: EditableRule): string => {
  if (rule.values.length === 0) return "Выбрать…"
  const labels = rule.values.map(
    (value) => optionsFor(rule).find((option) => option.value === value)?.label ?? value
  )
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`
}

const toggleValue = (rule: EditableRule, value: string) => {
  rule.values = rule.values.includes(value)
    ? rule.values.filter((item) => item !== value)
    : [...rule.values, value]
}

const onField = (rule: EditableRule, value: unknown) => changeField(rule, String(value) as PresetField)
const onOp = (rule: EditableRule, value: unknown) => changeOperator(rule, String(value) as PresetOperator)
const onText = (rule: EditableRule, value: unknown) => {
  rule.text = value === undefined || value === null ? "" : String(value)
}
const onLocation = (value: unknown) => {
  const next = value as KeywordMatchLocation
  state.value.location = PRESET_LOCATION_OPTIONS.some((option) => option.value === next) ? next : "any"
}

const toggleFlag = (key: "includeArchived" | "includeBlacklisted") => {
  state.value[key] = !state.value[key]
}

const flagClass = (on: boolean) =>
  on
    ? "border-primary bg-primary/15 text-foreground"
    : "border-border text-muted-foreground hover:bg-accent"

</script>

<template>
  <div class="space-y-2">
    <div v-if="state.rules.length > 0" class="space-y-1.5">
      <div
        v-for="rule in state.rules"
        :key="rule.id"
        class="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-1.5 py-1"
        :class="isComplete(rule) ? 'border-border' : 'border-dashed border-amber-500/60'"
      >
        <Select :model-value="rule.field" :disabled="props.disabled" @update:model-value="(v) => onField(rule, v)">
          <SelectTrigger class="h-7 w-[170px] text-xs" :title="meta(rule).hint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="max-h-80">
            <template v-for="group in PRESET_FIELD_GROUPS" :key="group.group">
              <SelectItem v-for="m in group.fields" :key="m.field" :value="m.field">
                {{ m.label }}
              </SelectItem>
            </template>
          </SelectContent>
        </Select>

        <Select :model-value="rule.op" :disabled="props.disabled" @update:model-value="(v) => onOp(rule, v)">
          <SelectTrigger class="h-7 w-[124px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="op in meta(rule).ops" :key="op" :value="op">
              {{ presetOperatorLabel(op) }}
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Boolean rules are fully described by the operator. -->
        <template v-if="meta(rule).kind === 'boolean'" />

        <Input
          v-else-if="meta(rule).kind === 'number'"
          type="number"
          class="h-7 w-28 text-xs"
          placeholder="Число"
          :model-value="rule.text"
          :disabled="props.disabled"
          @update:model-value="(v) => onText(rule, v)"
        />

        <!-- Several values from a list: one button, the list opens in a popover. -->
        <Popover v-else-if="usesList(rule.field) && isMultiValueOperator(rule.op)">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="inline-flex h-7 min-w-[140px] max-w-full flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-left text-xs hover:bg-accent disabled:opacity-50"
              :class="rule.values.length === 0 ? 'text-muted-foreground' : ''"
              :disabled="props.disabled"
            >
              <span class="truncate">{{ listSummary(rule) }}</span>
              <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent :class="rule.field === 'keywords' ? 'w-[420px]' : 'w-64'" align="start">
            <KeywordPicker
              v-if="rule.field === 'keywords'"
              :model-value="rule.values"
              :keywords="lexicon"
              :loading="lexiconQuery.isPending.value"
              :disabled="props.disabled"
              @update:model-value="(values) => (rule.values = values)"
            />
            <div v-else class="flex flex-col gap-0.5">
              <label
                v-for="option in optionsFor(rule)"
                :key="option.value"
                class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
              >
                <input
                  type="checkbox"
                  class="size-3.5 rounded border-input accent-primary"
                  :checked="rule.values.includes(option.value)"
                  @change="toggleValue(rule, option.value)"
                />
                {{ option.label }}
              </label>
            </div>
          </PopoverContent>
        </Popover>

        <Select
          v-else-if="meta(rule).kind === 'select'"
          :model-value="rule.text"
          :disabled="props.disabled"
          @update:model-value="(v) => onText(rule, v)"
        >
          <SelectTrigger class="h-7 min-w-[140px] flex-1 text-xs">
            <SelectValue placeholder="Значение" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in optionsFor(rule)" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Input
          v-else
          type="text"
          class="h-7 min-w-[140px] flex-1 text-xs"
          :placeholder="isMultiValueOperator(rule.op) ? 'через запятую' : 'Значение'"
          :model-value="rule.text"
          :disabled="props.disabled"
          @update:model-value="(v) => onText(rule, v)"
        />

        <button
          type="button"
          class="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Удалить правило"
          :disabled="props.disabled"
          @click="removeRule(rule.id)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <Popover v-model:open="addOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            :disabled="props.disabled"
          >
            <Plus class="h-3.5 w-3.5" />
            Правило
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-2" align="start">
          <div class="relative mb-1.5">
            <Search class="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input v-model="addSearch" class="h-7 pl-7 text-xs" placeholder="Поле…" />
          </div>
          <div class="max-h-72 overflow-auto">
            <div v-for="group in addGroups" :key="group.group" class="mb-1">
              <p class="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {{ group.group }}
              </p>
              <button
                v-for="m in group.fields"
                :key="m.field"
                type="button"
                class="block w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                :title="m.hint"
                @click="addRule(m.field)"
              >
                {{ m.label }}
              </button>
            </div>
            <p v-if="addGroups.length === 0" class="p-2 text-xs text-muted-foreground">Ничего не найдено.</p>
          </div>
        </PopoverContent>
      </Popover>

      <template v-if="state.rules.length === 0">
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
        <span class="mx-1 hidden h-4 w-px bg-border sm:block" />
        <button
          type="button"
          class="inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50"
          :class="flagClass(state.includeArchived)"
          :disabled="props.disabled"
          @click="toggleFlag('includeArchived')"
        >
          Архивные
        </button>
        <button
          type="button"
          class="inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50"
          :class="flagClass(state.includeBlacklisted)"
          :disabled="props.disabled"
          @click="toggleFlag('includeBlacklisted')"
        >
          Заблокированные
        </button>

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
