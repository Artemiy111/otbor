<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { PresetField, PresetOperator } from "@otbor/contract"
import { ChevronDown, GripVertical, Lock, X } from "@lucide/vue"
import { areaLabel } from "@/shared/lib"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { hhAccountApi, hhAccountKeys, hhAccountName } from "@/entities/hh-account"
import {
  Button,
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
  SALARY_CURRENCIES,
  appliedAccountOptions,
  appliedResumeOptions,
  hiddenAccountOptions,
  isMultiValueOperator,
  presetFieldMeta,
  presetOperatorLabel
} from "../model/fields"
import {
  changeField,
  changeOperator,
  isComplete,
  usesList,
  type EditableRule
} from "../model/editable"
import FieldPicker from "./FieldPicker.vue"
import AreaPicker from "./AreaPicker.vue"
import KeywordPicker from "./KeywordPicker.vue"
import TagInput from "./TagInput.vue"
import ValuePicker from "./ValuePicker.vue"

/**
 * Одна строка правила в новом блоке фильтров. Вместо «таблетки» с !important
 * и color-mix используем обычные токены и общие компоненты: рамка только у
 * самой строки, контролы остаются в едином стиле приложения.
 */
const props = withDefaults(
  defineProps<{
    rule: EditableRule
    disabled?: boolean
    count?: number
    dropped?: number
    showCount?: boolean
    sortable?: boolean
    autofocus?: boolean
    locked?: boolean
  }>(),
  {
    disabled: false,
    count: undefined,
    dropped: undefined,
    showCount: false,
    sortable: false,
    autofocus: false,
    locked: false
  }
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
/** Высота контролов: плотный ряд без выбивающихся размеров. */
const control = "h-7"
const usesAppliedSelectors = (field: PresetField): boolean => field === "applied" || field === "applied_vacancy"

const lexiconQuery = useQuery({
  key: () => keywordKeys.list(""),
  query: () => keywordApi.list({ limit: 5000 }),
  enabled: () => props.rule.field === "keywords"
})
const lexicon = computed(() => lexiconQuery.data.value ?? [])

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list(),
  enabled: () => props.rule.field === "hidden" || usesAppliedSelectors(props.rule.field)
})

const resumesQuery = useQuery({
  key: () => resumeKeys.list(),
  query: () => resumeApi.list(),
  enabled: () => usesAppliedSelectors(props.rule.field)
})

const accounts = computed(() => accountsQuery.data.value ?? [])
const resumes = computed(() => resumesQuery.data.value ?? [])

const options = computed(() => {
  const base = [...(meta.value.options ?? [])]
  if (props.rule.field === "hidden") {
    base.push(
      ...hiddenAccountOptions(accounts.value.map((account) => ({ id: account.id, name: hhAccountName(account) })))
    )
  }
  if (usesAppliedSelectors(props.rule.field)) {
    const accountNames = new Map(accounts.value.map((account) => [account.id as string, hhAccountName(account)]))
    base.push(
      ...appliedAccountOptions(accounts.value.map((account) => ({ id: account.id, name: hhAccountName(account) }))),
      ...appliedResumeOptions(
        resumes.value.map((resume) => ({
          id: resume.id,
          title: resume.title,
          accountName: accountNames.get(resume.hhAccountId) ?? "?",
          accountId: resume.hhAccountId
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
    data-filter-row
    class="group flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-accent/40"
  >
    <div class="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
      <button
        v-if="props.sortable"
        type="button"
        draggable="true"
        class="-ml-0.5 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
        title="Перетащите, чтобы поменять порядок"
        tabindex="-1"
        :disabled="props.disabled"
        @dragstart="emit('dragstart', $event)"
        @dragend="emit('dragend')"
      >
        <GripVertical class="size-3.5" />
      </button>

      <div
        v-if="props.locked"
        class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 text-xs text-muted-foreground"
        :class="control"
        title="Обязательное правило: его нельзя удалить или изменить"
      >
        <Lock class="size-3.5 shrink-0" />
        <span class="truncate">Вакансия не архивная</span>
      </div>

      <template v-else>
        <FieldPicker compact :current="rule.field" :disabled="props.disabled" @pick="onField" />

        <Select :model-value="rule.op" :disabled="props.disabled" @update:model-value="onOp">
          <SelectTrigger
            class="shrink-0 text-xs"
            :class="[
              control,
              meta.kind === 'number'
                ? 'w-[68px] font-mono'
                : rule.op.endsWith('_any')
                  ? 'w-[164px]'
                  : 'w-[108px]'
            ]"
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
            class="w-24 text-xs"
            :class="control"
            placeholder="Число"
            :model-value="rule.text"
            :disabled="props.disabled"
            @update:model-value="onText"
          />
          <template v-if="meta.salary">
            <Select
              :model-value="rule.currency === '' ? 'any' : rule.currency"
              :disabled="props.disabled"
              @update:model-value="onCurrency"
            >
              <SelectTrigger class="w-[84px] text-xs" :class="control" title="Валюта вакансии">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">любая</SelectItem>
                <SelectItem v-for="currency in SALARY_CURRENCIES" :key="currency.value" :value="currency.value">
                  {{ currency.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              class="px-2 text-xs font-normal"
              :class="[control, rule.orMissing ? 'bg-primary/10 text-foreground' : 'text-muted-foreground']"
              title="Вакансии без указанной зарплаты тоже проходят"
              :disabled="props.disabled"
              @click="rule.orMissing = !rule.orMissing"
            >
              или не указана
            </Button>
          </template>
        </template>

        <ValuePicker
          v-else-if="
            usesList(rule.field) &&
            isMultiValueOperator(rule.op) &&
            (usesAppliedSelectors(rule.field) || rule.field === 'hidden')
          "
          :model-value="rule.values"
          :options="options"
          :accounts="accounts"
          :resumes="resumes"
          :autofocus="props.autofocus"
          :disabled="props.disabled"
          placeholder="Выбрать…"
          search-placeholder="Аккаунт или резюме…"
          @update:model-value="(values) => (rule.values = values)"
        />

        <Popover v-else-if="usesList(rule.field) && isMultiValueOperator(rule.op)" :default-open="openList">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="inline-flex min-w-0 max-w-full flex-1 items-center justify-between gap-1 bg-transparent px-2 text-left text-xs hover:bg-accent disabled:opacity-50"
              :class="[control, rule.values.length === 0 ? 'text-muted-foreground' : '']"
              :disabled="props.disabled"
            >
              <span class="truncate">{{ summary }}</span>
              <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            :class="rule.field === 'keywords' || rule.field === 'location' ? 'w-[420px]' : 'w-64'"
            align="start"
          >
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
          <SelectTrigger class="min-w-0 flex-1 text-xs" :class="control">
            <SelectValue placeholder="Значение" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in options" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
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
          class="min-w-0 flex-1 text-xs"
          :class="control"
          placeholder="Значение"
          :model-value="rule.text"
          :disabled="props.disabled"
          @update:model-value="onText"
        />
      </template>
    </div>

    <div class="ml-1 flex shrink-0 items-center gap-1">
      <span
        v-if="props.showCount"
        class="inline-flex w-11 items-baseline justify-end text-xs tabular-nums"
        :title="
          props.count === undefined
            ? ''
            : `После этого правила остаётся ${props.count.toLocaleString('ru-RU')} вакансий` +
              (props.dropped ? `, оно отсекло ${props.dropped.toLocaleString('ru-RU')}` : '')
        "
      >
        <span v-if="props.count !== undefined" class="text-foreground/70">
          {{ props.count.toLocaleString("ru-RU") }}
        </span>
      </span>

      <Button
        v-if="!props.locked"
        variant="ghost"
        size="sm"
        class="size-7 p-0 text-muted-foreground hover:text-destructive"
        title="Удалить правило"
        :disabled="props.disabled"
        @click="emit('remove')"
      >
        <X class="size-3.5" />
      </Button>
    </div>
  </div>
</template>
