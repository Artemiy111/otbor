<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue"
import { useDebounceFn } from "@vueuse/core"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ApplyFilterView, PresetPreview, PresetRecord, TestsPolicy } from "@otbor/contract"
import { ArrowRight, CircleAlert, Copy, Save } from "@lucide/vue"
import {
  applyFilterApi,
  applyFilterKeys,
  applyFilterSourceHint,
  applyFilterSourceLabel,
  autoModeOptions,
  testsPolicyOptions
} from "@/entities/apply-filter"
import { autoModeTone } from "@/entities/auto-apply"
import { presetApi, presetKeys } from "@/entities/preset"
import {
  FilterTargetPicker,
  UnsavedChangesSheet,
  useFilterTarget,
  useUnsavedGuard,
  type FilterTarget
} from "@/features/filter-target"
import { RefreshButton } from "@/features/refresh-button"
import { RuleBuilder, allRules, buildFilter, isComplete, toEditable } from "@/features/rule-builder"
import { PresetPreviewPanel } from "@/pages/presets"
import { applyFilterHelp } from "../model/help"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  FieldLabel,
  HelpHint,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const queryCache = useQueryCache()
const filterTarget = useFilterTarget()
const { accountId, resumeId } = filterTarget

const presetsQuery = useQuery({ key: () => presetKeys.list("all"), query: () => presetApi.list({}) })
const presets = computed<ReadonlyArray<PresetRecord>>(() => presetsQuery.data.value ?? [])
const presetId = ref<string>("")

const viewQuery = useQuery({
  key: () => applyFilterKeys.get(accountId.value, resumeId.value),
  query: () => applyFilterApi.get({ hhAccountId: accountId.value, resumeId: resumeId.value }),
  enabled: () => accountId.value !== ""
})
/** Ответ сервера только для выбранной пары: после смены пары старый не показываем. */
const view = computed<ApplyFilterView | null>(() => {
  const value = viewQuery.data.value ?? null
  return value !== null && value.hhAccountId === accountId.value && (value.resumeId ?? null) === resumeId.value
    ? value
    : null
})

const applyPresets = computed(() => presets.value.filter((preset) => preset.kind === "apply"))
const otherPresets = computed(() => presets.value.filter((preset) => preset.kind !== "apply"))

const filter = ref(reactive(toEditable(undefined)))
const minFit = ref(45)
const tests = ref<TestsPolicy>("human")
const halfLife = ref(72)
const formError = ref<string | null>(null)
const toast = useToast()

/** Ключ формы: по нему видно, что правки есть. Снимается при загрузке тем же кодом, что и текущий. */
const formKey = () => JSON.stringify([buildFilter(filter.value), minFit.value, tests.value, halfLife.value])
const loadedKey = ref<string | null>(null)
const dirty = computed(() => loadedKey.value !== null && formKey() !== loadedKey.value)

type LoadSource = Pick<ApplyFilterView, "filter" | "minFit" | "tests" | "freshHalfLifeHours">
let lastSource: LoadSource | null = null

/** Форма следует за тем, что сервер считает действующим для выбранной пары. */
const load = (value: LoadSource) => {
  lastSource = value
  filter.value = reactive(toEditable(value.filter))
  minFit.value = value.minFit
  tests.value = value.tests
  halfLife.value = value.freshHalfLifeHours
  formError.value = null
  loadedKey.value = formKey()
}

const targetKey = computed(() => `${accountId.value}|${resumeId.value ?? ""}`)
let loadedFor = ""
watch(
  [view, targetKey],
  () => {
    const value = view.value
    if (value === null) return
    if (loadedFor !== targetKey.value || !dirty.value) {
      load(value)
      loadedFor = targetKey.value
    }
  },
  { immediate: true }
)

const guard = useUnsavedGuard(dirty)
const confirmPreset = ref(false)
const onSelect = (next: FilterTarget) => guard.confirmThen(() => filterTarget.select(next))

const incomplete = computed(() => allRules(filter.value).some((rule) => !isComplete(rule)))

/** Живой подсчёт: сколько вакансий проходит правила (пересчёт после каждой правки). */
const preview = ref<PresetPreview | null>(null)
const previewError = ref<string | null>(null)
const previewing = ref(false)
const runPreview = async () => {
  previewing.value = true
  previewError.value = null
  try {
    preview.value = await presetApi.preview(buildFilter(filter.value))
  } catch (cause) {
    preview.value = null
    previewError.value = describeError(cause)
  } finally {
    previewing.value = false
  }
}
const schedulePreview = useDebounceFn(runPreview, 500)
watch(() => buildFilter(filter.value), () => void schedulePreview(), { deep: true })
onMounted(() => void runPreview())

const invalidate = () => queryCache.invalidateQueries({ key: applyFilterKeys.all })

/**
 * Одна RPC пишет и правила, и настройки автооткликов. Чужая половина берётся
 * из свежего ответа сервера внутри `saveRules`, а не из этой формы.
 */
const setMutation = useMutation({
  mutation: (_: void) =>
    applyFilterApi.saveRules(
      { hhAccountId: accountId.value, resumeId: resumeId.value },
      {
        filter: buildFilter(filter.value),
        minFit: minFit.value,
        tests: tests.value,
        freshHalfLifeHours: halfLife.value
      }
    )
})

const presetMutation = useMutation({
  mutation: (_: void) =>
    applyFilterApi.fromPreset({
      hhAccountId: accountId.value,
      resumeId: resumeId.value,
      presetId: presetId.value
    })
})

const save = async () => {
  if (!Number.isInteger(minFit.value) || minFit.value < 0 || minFit.value > 100) {
    formError.value = "Минимальное соответствие: целое число от 0 до 100."
    return
  }
  if (!Number.isInteger(halfLife.value) || halfLife.value < 1) {
    formError.value = "Период свежести: целое число часов, не меньше 1."
    return
  }
  formError.value = null
  try {
    const saved = await setMutation.mutateAsync()
    load(saved)
    toast.success("Фильтр сохранён")
    await invalidate()
  } catch (cause) {
    toast.error("Не удалось сохранить фильтр", { description: describeError(cause) })
  }
}

const copyPreset = async () => {
  confirmPreset.value = false
  if (presetId.value === "") return
  try {
    const saved = await presetMutation.mutateAsync()
    load(saved)
    toast.success("Правила скопированы из пресета и сохранены", {
      description: "Дальнейшие правки пресета этот фильтр не изменят."
    })
    await invalidate()
  } catch (cause) {
    toast.error("Не удалось применить пресет", { description: describeError(cause) })
  }
}
/** Копирование заменяет правила в форме: при несохранённых правках сначала спрашиваем. */
const fromPreset = () => {
  if (presetId.value === "") return
  if (dirty.value) confirmPreset.value = true
  else void copyPreset()
}

const loadError = computed(() => (viewQuery.error.value === null ? null : describeError(viewQuery.error.value)))
const busy = computed(() => setMutation.isLoading.value || presetMutation.isLoading.value)

const templateTitle = computed(
  () => presets.value.find((preset) => preset.id === view.value?.templatePresetId)?.title ?? null
)

const sourceHint = computed(() =>
  view.value === null ? "" : applyFilterSourceHint(view.value.source, resumeId.value !== null)
)
const modeLabel = computed(
  () => autoModeOptions.find((option) => option.value === view.value?.autoMode)?.label ?? ""
)
const autoHref = computed(() => filterTarget.pathWithTarget("/auto-apply"))
const targetReady = computed(() => accountId.value !== "")
</script>

<template>
  <section class="space-y-4 pb-4">
    <PageHeader
      title="Фильтр откликов"
      description="Какие вакансии подходят: правила, порог соответствия, тесты и свежесть. Режим и лимиты автооткликов настраиваются на странице «Автоотклики»."
    >
      <template #actions>
        <RefreshButton :loading="viewQuery.isLoading.value" @refresh="viewQuery.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="loadError" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить фильтр</AlertTitle>
      <AlertDescription>{{ loadError }}</AlertDescription>
    </Alert>

    <FilterTargetPicker
      v-if="targetReady"
      :state="filterTarget"
      :disabled="busy"
      :resume-hint="applyFilterHelp.allResumes"
      @select="onSelect"
    />

    <div v-if="targetReady && view === null && !loadError" class="space-y-4">
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-if="view !== null">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <Badge :variant="view.source === 'exact' ? 'default' : 'secondary'">
          {{ applyFilterSourceLabel(view.source, resumeId !== null) }}
        </Badge>
        <HelpHint :text="applyFilterHelp.source" label="чей это фильтр" />
        <span v-if="view.updatedAt" class="text-xs text-muted-foreground">обновлён {{ formatDate(view.updatedAt) }}</span>
        <span v-if="templateTitle" class="text-xs text-muted-foreground">· скопирован из пресета «{{ templateTitle }}»</span>
      </div>
      <p v-if="sourceHint" class="text-xs text-muted-foreground">{{ sourceHint }}</p>

      <!-- Режим автооткликов здесь только показан: настраивается на своей странице. -->
      <p class="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <span class="text-muted-foreground">Режим автооткликов:</span>
        <Badge :variant="autoModeTone(view.autoMode)">{{ modeLabel }}</Badge>
        <span class="text-muted-foreground">·</span>
        <a :href="autoHref" class="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          настроить
          <ArrowRight class="size-3.5" />
        </a>
      </p>

      <Card>
        <CardContent class="space-y-2 p-4">
          <h2 class="text-sm font-semibold">Начать с пресета</h2>
          <p class="text-xs text-muted-foreground">
            Правила скопируются; пресет не изменится. Текущие правила этого фильтра будут заменены и сохранены сразу.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Select v-model="presetId" :disabled="busy">
              <SelectTrigger class="h-8 w-full text-sm sm:w-[280px]"><SelectValue placeholder="Выберите пресет" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="preset in applyPresets" :key="preset.id" :value="preset.id">
                  {{ preset.title }}
                </SelectItem>
                <SelectItem v-for="preset in otherPresets" :key="preset.id" :value="preset.id">
                  {{ preset.title }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" :disabled="busy || presetId === ''" @click="fromPreset">
              <Copy class="size-4" />
              {{ presetMutation.isLoading.value ? "Копирую…" : "Скопировать правила" }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="space-y-4 p-4">
          <div>
            <div class="flex flex-wrap items-center gap-1">
              <h2 class="text-sm font-semibold">Правила фильтра</h2>
              <HelpHint :text="applyFilterHelp.rules" label="правила фильтра" />
              <HelpHint :text="applyFilterHelp.listValues" label="списки значений" />
              <span class="ml-auto text-xs text-muted-foreground" role="status">
                <template v-if="previewing">Считаю…</template>
                <template v-else-if="preview !== null">
                  Под правила подходит: <b class="text-base text-foreground tabular-nums">{{ preview.count }}</b> вакансий
                </template>
                <template v-if="incomplete"> · неполные правила не учитываются</template>
              </span>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              Жёсткие условия: вакансия, не прошедшая их, отклика не получит.
            </p>
          </div>

          <RuleBuilder v-model="filter" :disabled="busy" />

          <PresetPreviewPanel
            v-if="preview !== null || previewError !== null"
            :preview="preview"
            :loading="previewing"
            :error="previewError"
            hint="Что выберут эти правила; обновляется при правке"
          />

          <div class="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div class="space-y-1">
              <FieldLabel :hint="applyFilterHelp.minFit">Минимальное соответствие (0–100)</FieldLabel>
              <Input v-model.number="minFit" type="number" min="0" max="100" class="h-8" :disabled="busy" />
            </div>
            <div class="space-y-1">
              <FieldLabel :hint="applyFilterHelp.tests">Тестовые задания</FieldLabel>
              <Select v-model="tests" :disabled="busy">
                <SelectTrigger class="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in testsPolicyOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1">
              <FieldLabel :hint="applyFilterHelp.halfLife">Период свежести, часов</FieldLabel>
              <Input v-model.number="halfLife" type="number" min="1" class="h-8" :disabled="busy" />
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Одна кнопка сохранения на страницу; панель прилипает к низу, пока есть правки. -->
      <div
        v-if="dirty || setMutation.isLoading.value || formError"
        class="sticky bottom-0 z-10 space-y-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
      >
        <Alert v-if="formError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Проверьте форму</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <div class="flex flex-wrap items-center gap-2">
          <Button :disabled="busy || !dirty" @click="save">
            <Save class="size-4" />
            {{ setMutation.isLoading.value ? "Сохраняю…" : "Сохранить фильтр" }}
          </Button>
          <Button variant="ghost" :disabled="busy" @click="lastSource && load(lastSource)">Отменить правки</Button>
          <span v-if="dirty" class="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <span class="size-2 rounded-full bg-warning" aria-hidden="true" />
            Есть несохранённые изменения
          </span>
        </div>
      </div>
    </template>

    <UnsavedChangesSheet :open="guard.open.value" @leave="guard.leave" @stay="guard.stay" />
    <UnsavedChangesSheet
      :open="confirmPreset"
      description="Правила из пресета заменят то, что вы сейчас правили, и сохранятся сразу."
      leave-label="Заменить правила"
      @leave="copyPreset"
      @stay="confirmPreset = false"
    />
  </section>
</template>
