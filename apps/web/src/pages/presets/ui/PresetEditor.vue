<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type {
  KeywordMatchLocation,
  PresetField,
  PresetFilter,
  PresetKind,
  PresetOperator,
  PresetPreview,
  PresetRecord,
  PresetRule
} from "@otbor/contract"
import { parsePresetFilter } from "@otbor/contract"
import { CircleAlert, Eye, Plus, Save, Trash2 } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { presetApi } from "@/entities/preset"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"
import PresetKeywordPicker from "./PresetKeywordPicker.vue"
import PresetPreviewPanel from "./PresetPreviewPanel.vue"
import {
  PRESET_FIELD_GROUPS,
  PRESET_LOCATION_OPTIONS,
  isMultiValueOperator,
  presetFieldMeta,
  presetOperatorLabel,
  type PresetFieldOption
} from "../model/fields"
import { presetRules } from "../model/rules"

const props = withDefaults(
  defineProps<{
    preset: PresetRecord | null
    saving?: boolean
    error?: string | null
  }>(),
  { saving: false, error: null }
)

const emit = defineEmits<{
  save: [input: { title: string; kind: PresetKind; filter: PresetFilter }]
  cancel: []
}>()

interface EditableRule {
  /** Stable row key: index keys would reuse input state after a removal. */
  id: number
  field: PresetField
  op: PresetOperator
  /** Scalar control: text, number or a single select value. */
  text: string
  /** Multi-value control: select chips and the keyword picker. */
  values: ReadonlyArray<string>
}

let ruleSequence = 0

const initialFilter = props.preset?.filter
const title = ref(props.preset?.title ?? "")
const kind = ref<PresetKind>(props.preset?.kind ?? "explore")
const includeArchived = ref(initialFilter?.includeArchived === true)
const includeBlacklisted = ref(initialFilter?.includeBlacklisted === true)
const location = ref<KeywordMatchLocation>(initialFilter?.location ?? "any")
const formError = ref<string | null>(null)

const editableRule = (rule: PresetRule): EditableRule => {
  const meta = presetFieldMeta(rule.field)
  const base: EditableRule = {
    id: ruleSequence++,
    field: rule.field,
    op: rule.op,
    text: "",
    values: []
  }
  if (meta.kind === "boolean") return base
  if (Array.isArray(rule.value)) {
    if (isMultiValueOperator(rule.op) && (meta.field === "keywords" || meta.kind === "select")) {
      return { ...base, values: rule.value.map((value) => String(value)) }
    }
    return { ...base, text: rule.value.join(", ") }
  }
  return { ...base, text: rule.value === undefined ? "" : String(rule.value) }
}

const rules = ref<Array<EditableRule>>(
  (initialFilter === undefined ? [] : presetRules(initialFilter)).map(editableRule)
)

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

const addRule = () => {
  rules.value.push({
    id: ruleSequence++,
    field: "title",
    op: "contains",
    text: "",
    values: []
  })
}

const removeRule = (index: number) => {
  rules.value.splice(index, 1)
}

const fieldMeta = (rule: EditableRule) => presetFieldMeta(rule.field)

const setField = (index: number, field: string) => {
  const rule = rules.value[index]
  if (rule === undefined) return
  const meta = presetFieldMeta(field as PresetField)
  rule.field = meta.field
  rule.op = meta.ops[0] ?? "eq"
  rule.text = ""
  rule.values = []
}

const setOp = (index: number, op: string) => {
  const rule = rules.value[index]
  if (rule === undefined) return
  const next = op as PresetOperator
  const meta = presetFieldMeta(rule.field)
  const usesList = meta.field === "keywords" || meta.kind === "select"

  if (usesList && isMultiValueOperator(next) && !isMultiValueOperator(rule.op)) {
    const single = rule.text.trim()
    if (single !== "") rule.values = [single]
    rule.text = ""
  } else if (usesList && !isMultiValueOperator(next) && isMultiValueOperator(rule.op)) {
    rule.text = rule.values[0] ?? ""
    rule.values = []
  }

  rule.op = next
}

const setText = (index: number, value: unknown) => {
  const rule = rules.value[index]
  if (rule === undefined) return
  rule.text = value === undefined || value === null ? "" : String(value)
}

const setKind = (value: unknown) => {
  kind.value = value === "apply" ? "apply" : "explore"
}

const setLocation = (value: unknown) => {
  const next = value as KeywordMatchLocation
  location.value = PRESET_LOCATION_OPTIONS.some((option) => option.value === next)
    ? next
    : "any"
}

const setValues = (index: number, values: ReadonlyArray<string>) => {
  const rule = rules.value[index]
  if (rule === undefined) return
  rule.values = [...values]
}

const selectOptions = (rule: EditableRule): ReadonlyArray<PresetFieldOption> => {
  const base = [...(fieldMeta(rule).options ?? [])]
  const known = new Set(base.map((option) => option.value))
  for (const value of [rule.text, ...rule.values]) {
    if (value !== "" && !known.has(value)) {
      base.push({ value, label: value })
      known.add(value)
    }
  }
  return base
}

const toggleValue = (index: number, value: string) => {
  const rule = rules.value[index]
  if (rule === undefined) return
  rule.values = rule.values.includes(value)
    ? rule.values.filter((item) => item !== value)
    : [...rule.values, value]
}

const ruleTone = (rule: EditableRule): string => {
  switch (fieldMeta(rule).kind) {
    case "number":
      return "border-l-rose-400/70"
    case "select":
      return "border-l-violet-400/70"
    case "boolean":
      return "border-l-slate-400/70"
    default:
      return "border-l-sky-400/70"
  }
}

/* -------------------------------------------------------------------------- */
/* Build and preview                                                          */
/* -------------------------------------------------------------------------- */

const buildRule = (rule: EditableRule): PresetRule | null => {
  const meta = fieldMeta(rule)
  if (meta.kind === "boolean") {
    return { field: rule.field, op: rule.op }
  }
  if (meta.kind === "number") {
    const text = rule.text.trim()
    const value = Number(text)
    if (text === "" || !Number.isFinite(value)) return null
    return { field: rule.field, op: rule.op, value }
  }
  if (isMultiValueOperator(rule.op)) {
    const terms = meta.field === "keywords" || meta.kind === "select"
      ? rule.values
      : rule.text.split(",")
    const values = [...new Set(terms.map((value) => value.trim()).filter((value) => value !== ""))]
    if (values.length === 0) return null
    return { field: rule.field, op: rule.op, value: values }
  }
  const value = rule.text.trim()
  if (value === "") return null
  return { field: rule.field, op: rule.op, value }
}

const keywordIds = computed(() => props.preset?.filter.keywordIds)

const buildFilter = (): PresetFilter =>
  parsePresetFilter({
    rules: rules.value
      .map(buildRule)
      .filter((rule): rule is PresetRule => rule !== null),
    ...(includeArchived.value ? { includeArchived: true } : {}),
    ...(includeBlacklisted.value ? { includeBlacklisted: true } : {}),
    ...(location.value === "any" ? {} : { location: location.value }),
    ...(keywordIds.value === undefined ? {} : { keywordIds: keywordIds.value })
  })

const incompleteRule = computed(() =>
  rules.value.find((rule) => buildRule(rule) === null)
)

const preview = ref<PresetPreview | null>(null)
const previewError = ref<string | null>(null)
const previewing = ref(false)

const lexiconQuery = useQuery({
  key: () => keywordKeys.list(""),
  query: () => keywordApi.list({ limit: 5000 })
})
const lexicon = computed(() => lexiconQuery.data.value ?? [])

const runPreview = async () => {
  const incomplete = incompleteRule.value
  if (incomplete !== undefined) {
    previewError.value = `Заполните значение правила «${fieldMeta(incomplete).label}».`
    return
  }
  previewing.value = true
  previewError.value = null
  try {
    preview.value = await presetApi.preview(buildFilter())
  } catch (cause) {
    preview.value = null
    previewError.value = describeError(cause)
  } finally {
    previewing.value = false
  }
}

const submit = () => {
  const trimmed = title.value.trim()
  if (trimmed === "") {
    formError.value = "Введите название пресета."
    return
  }
  const incomplete = incompleteRule.value
  if (incomplete !== undefined) {
    formError.value = `Заполните значение правила «${fieldMeta(incomplete).label}» или удалите его.`
    return
  }
  formError.value = null
  emit("save", { title: trimmed, kind: kind.value, filter: buildFilter() })
}

onMounted(() => {
  if (props.preset !== null) void runPreview()
})
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader class="gap-2 pb-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <CardTitle class="text-base">
              {{ props.preset === null ? "Новый пресет" : "Изменить пресет" }}
            </CardTitle>
            <CardDescription>
              Пресет — это набор правил «и» по корпусу вакансий. Пустые правила не сохраняются.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" class="shrink-0" @click="emit('cancel')">
            Отмена
          </Button>
        </div>
      </CardHeader>

      <CardContent class="space-y-4 border-t border-border pt-4">
        <Alert v-if="formError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Проверьте форму</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <Alert v-if="props.error" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось сохранить пресет</AlertTitle>
          <AlertDescription>{{ props.error }}</AlertDescription>
        </Alert>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="space-y-1.5 md:col-span-2">
            <Label for="preset-editor-title">Название</Label>
            <Input
              id="preset-editor-title"
              v-model="title"
              type="text"
              placeholder="Например, Backend без архива"
              :disabled="props.saving"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="preset-editor-kind">Тип</Label>
            <Select :model-value="kind" @update:model-value="setKind">
              <SelectTrigger id="preset-editor-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="explore">Поиск (explore)</SelectItem>
                <SelectItem value="apply">Отклики (apply)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <Label for="preset-editor-location">Где искать ключевые слова</Label>
            <Select :model-value="location" @update:model-value="setLocation">
              <SelectTrigger id="preset-editor-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in PRESET_LOCATION_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label class="flex items-center gap-2 text-sm md:col-span-2">
            <input
              v-model="includeArchived"
              type="checkbox"
              class="size-4 rounded border-input accent-primary"
              :disabled="props.saving"
            />
            Показывать архивные
          </label>

          <label class="flex items-center gap-2 text-sm md:col-span-2">
            <input
              v-model="includeBlacklisted"
              type="checkbox"
              class="size-4 rounded border-input accent-primary"
              :disabled="props.saving"
            />
            Показывать заблокированные
          </label>

          <p
            v-if="keywordIds !== undefined && keywordIds.length > 0"
            class="text-[11px] text-muted-foreground md:col-span-2"
          >
            Ограничение словаря ({{ keywordIds.length }} терминов) сохранено из старой
            версии. Оно не влияет на срез вакансий и не редактируется здесь.
          </p>
        </div>

        <div class="space-y-2 border-t border-border pt-4">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-bold uppercase tracking-[0.06em]">Правила</span>
              <Badge variant="neutral" class="text-[10px]">{{ rules.length }}</Badge>
            </div>
            <Button variant="outline" size="sm" :disabled="props.saving" @click="addRule">
              <Plus class="h-3.5 w-3.5" />
              Правило
            </Button>
          </div>

          <p v-if="rules.length === 0" class="text-xs text-muted-foreground">
            Без правил пресет выбирает весь корпус с учётом настройки архива.
          </p>

          <div
            v-for="(rule, index) in rules"
            :key="rule.id"
            class="space-y-2 rounded-md border border-l-2 p-2.5"
            :class="ruleTone(rule)"
          >
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {{ index + 1 }}.
              </span>

              <Select
                :model-value="rule.field"
                @update:model-value="(value) => setField(index, String(value))"
              >
                <SelectTrigger class="h-8 w-[168px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent class="max-h-80">
                  <SelectGroup v-for="group in PRESET_FIELD_GROUPS" :key="group.group">
                    <SelectLabel>{{ group.group }}</SelectLabel>
                    <SelectItem
                      v-for="meta in group.fields"
                      :key="meta.field"
                      :value="meta.field"
                    >
                      {{ meta.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Select
                :model-value="rule.op"
                @update:model-value="(value) => setOp(index, String(value))"
              >
                <SelectTrigger class="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="op in fieldMeta(rule).ops"
                    :key="op"
                    :value="op"
                  >
                    {{ presetOperatorLabel(op) }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="ghost"
                size="sm"
                class="ml-auto size-7 shrink-0 px-0 text-muted-foreground"
                title="Удалить правило"
                :disabled="props.saving"
                @click="removeRule(index)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>

            <p v-if="fieldMeta(rule).kind === 'boolean'" class="text-[11px] text-muted-foreground">
              Значение задаёт оператор: «да» или «нет».
            </p>

            <PresetKeywordPicker
              v-else-if="fieldMeta(rule).field === 'keywords' && isMultiValueOperator(rule.op)"
              :model-value="rule.values"
              :keywords="lexicon"
              :loading="lexiconQuery.isPending.value"
              :disabled="props.saving"
              @update:model-value="(values) => setValues(index, values)"
            />

            <template v-else-if="fieldMeta(rule).kind === 'select'">
              <div
                v-if="isMultiValueOperator(rule.op)"
                class="flex flex-wrap gap-1"
              >
                <button
                  v-for="option in selectOptions(rule)"
                  :key="option.value"
                  type="button"
                  class="rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50"
                  :class="
                    rule.values.includes(option.value)
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  "
                  :disabled="props.saving"
                  @click="toggleValue(index, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>

              <Select
                v-else
                :model-value="rule.text"
                @update:model-value="(value) => setText(index, value)"
              >
                <SelectTrigger class="h-8 text-xs">
                  <SelectValue placeholder="Выберите значение" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in selectOptions(rule)"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <p
                v-if="isMultiValueOperator(rule.op)"
                class="text-[11px] text-muted-foreground"
              >
                Можно выбрать несколько значений.
              </p>
            </template>

            <Input
              v-else-if="fieldMeta(rule).kind === 'number'"
              type="number"
              :model-value="rule.text"
              placeholder="Число"
              class="h-8 text-xs"
              :disabled="props.saving"
              @update:model-value="(value) => setText(index, value)"
            />

            <Input
              v-else
              type="text"
              :model-value="rule.text"
              :placeholder="
                isMultiValueOperator(rule.op)
                  ? 'Через запятую: backend, frontend'
                  : 'Значение'
              "
              class="h-8 text-xs"
              :disabled="props.saving"
              @update:model-value="(value) => setText(index, value)"
            />

            <p
              v-if="fieldMeta(rule).hint && fieldMeta(rule).kind !== 'boolean'"
              class="text-[10px] text-muted-foreground"
            >
              {{ fieldMeta(rule).hint }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button :disabled="props.saving" @click="submit">
            <Save class="h-4 w-4" />
            {{ props.saving ? "Сохраняю…" : "Сохранить" }}
          </Button>
          <Button
            variant="outline"
            :disabled="props.saving || previewing"
            @click="runPreview"
          >
            <Eye class="h-4 w-4" />
            {{ previewing ? "Считаю…" : "Проверить" }}
          </Button>
          <span class="text-xs text-muted-foreground">
            После сохранения обновляются пресеты и счётчики ключевых слов.
          </span>
        </div>
      </CardContent>
    </Card>

    <PresetPreviewPanel
      v-if="preview !== null || previewError !== null || previewing"
      :preview="preview"
      :loading="previewing"
      :error="previewError"
      hint="Срез на момент проверки — обновите кнопкой «Проверить»"
    />
  </div>
</template>
