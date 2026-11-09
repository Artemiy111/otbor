<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { areaLabel } from "@/shared/lib"
import { useQuery } from "@pinia/colada"
import type { PresetField, PresetOperator } from "@otbor/contract"
import { ChevronDown, GripVertical, Sparkles, X } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { hhAccountApi, hhAccountKeys, hhAccountName } from "@/entities/hh-account"
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
  SALARY_CURRENCIES,
  appliedAccountOptions,
  appliedResumeOptions,
  hiddenAccountOptions,
  isMultiValueOperator,
  presetFieldMeta,
  presetOperatorLabel
} from "../model/fields"
import { changeField, changeOperator, isComplete, usesList, type EditableRule } from "../model/editable"
import FieldPicker from "./FieldPicker.vue"
import AreaPicker from "./AreaPicker.vue"
import KeywordPicker from "./KeywordPicker.vue"
import TagInput from "./TagInput.vue"

/** One rule on one line: field, operator, value (and currency for salary). Edited in place. */
const props = withDefaults(
  defineProps<{
    rule: EditableRule
    disabled?: boolean
    /** Сколько вакансий остаётся после этого правила (воронка). */
    count?: number
    /** Сколько вакансий это правило отсекло относительно предыдущего шага. */
    dropped?: number
    /** Только что добавленное правило: фокус на значение или открытый список. */
    autofocus?: boolean
    /** Резервирует колонку счётчиков, чтобы строки не «ехали», пока счёт считается. */
    showCount?: boolean
    /** Показывает ручку перетаскивания. */
    sortable?: boolean
  }>(),
  { disabled: false, count: undefined, dropped: undefined, autofocus: false, showCount: false, sortable: false }
)
const emit = defineEmits<{ remove: []; dragstart: [event: DragEvent]; dragend: [] }>()

const root = ref<HTMLElement | null>(null)
const openList = ref(props.autofocus)
onMounted(() => {
  if (!props.autofocus) return
  root.value?.querySelector<HTMLInputElement>("input[type=text], input[type=number], input:not([type])")?.focus()
})

const rule = computed(() => props.rule)
const meta = computed(() => presetFieldMeta(props.rule.field))

const lexiconQuery = useQuery({
  key: () => keywordKeys.list(""),
  query: () => keywordApi.list({ limit: 5000 }),
  enabled: () => props.rule.field === "keywords"
})
const lexicon = computed(() => lexiconQuery.data.value ?? [])

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list(),
  enabled: () => props.rule.field === "hidden" || props.rule.field === "applied"
})

const resumesQuery = useQuery({
  key: () => resumeKeys.list(),
  query: () => resumeApi.list(),
  enabled: () => props.rule.field === "applied"
})

const options = computed(() => {
  const base = [...(meta.value.options ?? [])]
  if (props.rule.field === "hidden") {
    base.push(
      ...hiddenAccountOptions(
        (accountsQuery.data.value ?? []).map((account) => ({ id: account.id, name: hhAccountName(account) }))
      )
    )
  }
  if (props.rule.field === "applied") {
    const accounts = accountsQuery.data.value ?? []
    const accountNames = new Map(accounts.map((account) => [account.id as string, hhAccountName(account)]))
    base.push(
      ...appliedAccountOptions(accounts.map((account) => ({ id: account.id, name: hhAccountName(account) }))),
      ...appliedResumeOptions(
        (resumesQuery.data.value ?? []).map((resume) => ({
          id: resume.id,
          title: resume.title,
          accountName: accountNames.get(resume.hhAccountId) ?? "?"
        }))
      )
    )
  }
  const known = new Set(base.map((option) => option.value))
  for (const value of [props.rule.text, ...props.rule.values]) {
    if (value !== "" && !known.has(value)) {
      base.push({ value, label: value })
      known.add(value)
    }
  }
  return base
})

const summary = computed(() => {
  if (props.rule.values.length === 0) return "Выбрать…"
  const labels = props.rule.values.map((value) =>
    props.rule.field === "location"
      ? areaLabel(value)
      : options.value.find((option) => option.value === value)?.label ?? value
  )
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`
})

const toggleValue = (value: string) => {
  rule.value.values = rule.value.values.includes(value)
    ? rule.value.values.filter((item) => item !== value)
    : [...rule.value.values, value]
}

const onField = (field: PresetField) => changeField(rule.value, field)
const onOp = (value: unknown) => changeOperator(rule.value, String(value) as PresetOperator)
const onText = (value: unknown) => {
  rule.value.text = value === undefined || value === null ? "" : String(value)
}
const onCurrency = (value: unknown) => {
  rule.value.currency = value === "any" ? "" : String(value)
}
</script>

<template>
  <div
    ref="root"
    data-rule-row
    class="flex items-center gap-1.5 border-l-2 py-0.5 pl-2"
    :class="isComplete(rule) ? 'border-transparent' : 'border-amber-500/70'"
  >
    <button
      v-if="props.sortable"
      type="button"
      draggable="true"
      class="-ml-1 inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
      title="Перетащите, чтобы поменять порядок"
      tabindex="-1"
      :disabled="props.disabled"
      @dragstart="emit('dragstart', $event)"
      @dragend="emit('dragend')"
    >
      <GripVertical class="h-3.5 w-3.5" />
    </button>
    <div class="rule-pill flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-input bg-card/40 transition-colors focus-within:border-ring/60">
    <FieldPicker :current="rule.field" :disabled="props.disabled" @pick="onField" />

    <Select :model-value="rule.op" :disabled="props.disabled" @update:model-value="onOp">
      <SelectTrigger
        class="h-8 shrink-0 text-xs text-muted-foreground"
        :class="meta.kind === 'number' ? 'w-[72px] font-mono' : rule.op.endsWith('_any') ? 'w-[176px]' : 'w-[116px]'"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="op in meta.ops" :key="op" :value="op">
          {{ presetOperatorLabel(op, rule.field) }}
        </SelectItem>
      </SelectContent>
    </Select>

    <template v-if="meta.kind === 'boolean'" />

    <template v-else-if="meta.kind === 'number'">
      <Input
        type="number"
        class="h-8 w-28 text-xs"
        placeholder="Число"
        :model-value="rule.text"
        :disabled="props.disabled"
        @update:model-value="onText"
      />
      <template v-if="meta.salary">
        <Select :model-value="rule.currency === '' ? 'any' : rule.currency" :disabled="props.disabled" @update:model-value="onCurrency">
          <SelectTrigger class="h-8 w-[96px] text-xs" title="Валюта вакансии">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">любая</SelectItem>
            <SelectItem v-for="currency in SALARY_CURRENCIES" :key="currency.value" :value="currency.value">
              {{ currency.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          class="inline-flex h-8 items-center px-2.5 text-xs transition-colors disabled:opacity-50"
          :class="rule.orMissing ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent'"
          title="Вакансии без указанной зарплаты тоже проходят"
          :disabled="props.disabled"
          @click="rule.orMissing = !rule.orMissing"
        >
          или не указана
        </button>
      </template>
    </template>

    <Popover v-else-if="usesList(rule.field) && isMultiValueOperator(rule.op)" :default-open="openList">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="inline-flex h-8 min-w-0 max-w-full flex-1 items-center justify-between gap-1 bg-transparent px-2 text-left text-xs hover:bg-accent disabled:opacity-50"
          :class="rule.values.length === 0 ? 'text-muted-foreground' : ''"
          :disabled="props.disabled"
        >
          <span class="truncate">{{ summary }}</span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent :class="rule.field === 'keywords' || rule.field === 'location' ? 'w-[420px]' : 'w-64'" align="start">
        <AreaPicker
          v-if="rule.field === 'location'"
          :model-value="rule.values"
          :disabled="props.disabled"
          @update:model-value="(values) => (rule.values = values)"
        />
        <KeywordPicker
          v-else-if="rule.field === 'keywords'"
          :model-value="rule.values"
          :keywords="lexicon"
          :loading="lexiconQuery.isPending.value"
          :disabled="props.disabled"
          @update:model-value="(values) => (rule.values = values)"
        />
        <div v-else class="flex flex-col gap-0.5">
          <label
            v-for="option in options"
            :key="option.value"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
          >
            <input
              type="checkbox"
              class="size-3.5 rounded border-input accent-primary"
              :checked="rule.values.includes(option.value)"
              @change="toggleValue(option.value)"
            />
            {{ option.label }}
          </label>
        </div>
      </PopoverContent>
    </Popover>

    <Select
      v-else-if="meta.kind === 'select'"
      :model-value="rule.text"
      :disabled="props.disabled"
      @update:model-value="onText"
    >
      <SelectTrigger class="h-8 min-w-0 flex-1 text-xs">
        <SelectValue placeholder="Значение" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
      </SelectContent>
    </Select>

    <TagInput
      v-else-if="isMultiValueOperator(rule.op)"
      :text="rule.text"
      :disabled="props.disabled"
      @update:text="onText"
    />

    <Input
      v-else
      type="text"
      class="h-8 min-w-0 flex-1 text-xs"
      placeholder="Значение"
      :model-value="rule.text"
      :disabled="props.disabled"
      @update:model-value="onText"
    />

    </div>
    <div class="flex shrink-0 items-center gap-1.5">
    <span
      v-if="props.showCount"
      class="inline-flex w-[44px] shrink-0 items-baseline justify-end text-[11px] tabular-nums"
      :title="
        props.count === undefined
          ? ''
          : `После этого правила остаётся ${props.count.toLocaleString('ru-RU')} вакансий` +
            (props.dropped ? `, оно само отсекло ${props.dropped.toLocaleString('ru-RU')}` : '') +
            '. Счёт идёт сверху вниз: порядок правил меняет только эти числа, не итог.'
      "
    >
      <span v-if="props.count !== undefined" class="text-right text-foreground/80">
        {{ props.count.toLocaleString("ru-RU") }}
      </span>
    </span>

    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Удалить правило"
      :disabled="props.disabled"
      @click="emit('remove')"
    >
      <X class="h-3.5 w-3.5" />
    </button>
    </div>
  </div>
</template>

<style scoped>
/* Правило как одна «таблетка»: сегменты без собственных рамок, между ними тонкие разделители. */
.rule-pill > :deep(*) {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
.rule-pill > :deep(* + *) {
  border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important;
}
</style>
