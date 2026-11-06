<script setup lang="ts">
import { computed } from "vue"
import { areaLabel } from "@/shared/lib"
import { useQuery } from "@pinia/colada"
import type { PresetField, PresetOperator } from "@otbor/contract"
import { ChevronDown, X } from "@lucide/vue"
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
import AreaPicker from "./AreaPicker.vue"
import KeywordPicker from "./KeywordPicker.vue"

/** One rule on one line: field, operator, value (and currency for salary). Edited in place. */
const props = withDefaults(defineProps<{ rule: EditableRule; disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ remove: [] }>()

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

const onField = (value: unknown) => changeField(rule.value, String(value) as PresetField)
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
    class="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-1.5 py-1"
    :class="isComplete(rule) ? 'border-border' : 'border-dashed border-amber-500/60'"
  >
    <Select :model-value="rule.field" :disabled="props.disabled" @update:model-value="onField">
      <SelectTrigger class="h-7 w-[170px] text-xs" :title="meta.hint">
        <SelectValue />
      </SelectTrigger>
      <SelectContent class="max-h-80">
        <template v-for="group in PRESET_FIELD_GROUPS" :key="group.group">
          <SelectItem v-for="m in group.fields" :key="m.field" :value="m.field">{{ m.label }}</SelectItem>
        </template>
        <SelectItem v-if="meta.legacy" :value="rule.field">{{ meta.label }}</SelectItem>
      </SelectContent>
    </Select>

    <Select :model-value="rule.op" :disabled="props.disabled" @update:model-value="onOp">
      <SelectTrigger class="h-7 text-xs" :class="meta.kind === 'number' ? 'w-[72px] font-mono' : 'w-[124px]'">
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
        class="h-7 w-28 text-xs"
        placeholder="Число"
        :model-value="rule.text"
        :disabled="props.disabled"
        @update:model-value="onText"
      />
      <template v-if="meta.salary">
        <Select :model-value="rule.currency === '' ? 'any' : rule.currency" :disabled="props.disabled" @update:model-value="onCurrency">
          <SelectTrigger class="h-7 w-[96px] text-xs" title="Валюта вакансии">
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
          class="inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50"
          :class="rule.orMissing ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'"
          title="Вакансии без указанной зарплаты тоже проходят"
          :disabled="props.disabled"
          @click="rule.orMissing = !rule.orMissing"
        >
          или не указана
        </button>
      </template>
    </template>

    <Popover v-else-if="usesList(rule.field) && isMultiValueOperator(rule.op)">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="inline-flex h-7 min-w-[140px] max-w-full flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-left text-xs hover:bg-accent disabled:opacity-50"
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
      <SelectTrigger class="h-7 min-w-[140px] flex-1 text-xs">
        <SelectValue placeholder="Значение" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
      </SelectContent>
    </Select>

    <Input
      v-else
      type="text"
      class="h-7 min-w-[140px] flex-1 text-xs"
      :placeholder="isMultiValueOperator(rule.op) ? 'через запятую' : 'Значение'"
      :model-value="rule.text"
      :disabled="props.disabled"
      @update:model-value="onText"
    />

    <button
      type="button"
      class="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      title="Удалить правило"
      :disabled="props.disabled"
      @click="emit('remove')"
    >
      <X class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
