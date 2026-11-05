<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ApplyFilterView, HhAccountRecord, PresetRecord, ResumeRecord, TestsPolicy } from "@otbor/contract"
import { CircleAlert, Copy, Save } from "@lucide/vue"
import { applyFilterApi, applyFilterKeys, applyFilterSourceLabel, testsPolicyOptions } from "@/entities/apply-filter"
import { hhAccountApi, hhAccountKeys, hhAccountName } from "@/entities/hh-account"
import { presetApi, presetKeys } from "@/entities/preset"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { RefreshButton } from "@/features/refresh-button"
import { RuleBuilder, allRules, buildFilter, isComplete, toEditable } from "@/features/rule-builder"
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import AutoApplySection from "./AutoApplySection.vue"

/** Select values cannot be empty: this stands for the account-level row. */
const ACCOUNT_DEFAULT = "__account__"

const queryCache = useQueryCache()
const initial = new URLSearchParams(window.location.search)

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const allResumes = computed<ReadonlyArray<ResumeRecord>>(() => resumesQuery.data.value ?? [])
const presetsQuery = useQuery({ key: () => presetKeys.list("all"), query: () => presetApi.list({}) })
const presets = computed<ReadonlyArray<PresetRecord>>(() => presetsQuery.data.value ?? [])

const accountId = ref<string>(initial.get("account") ?? "")
const resumeSelection = ref<string>(initial.get("resume") ?? ACCOUNT_DEFAULT)
const presetId = ref<string>("")

watch(
  accounts,
  (list) => {
    if (accountId.value === "" || !list.some((account) => account.id === accountId.value)) {
      const pick = list.find((account) => account.isDefault) ?? list[0]
      if (pick !== undefined) accountId.value = pick.id
    }
  },
  { immediate: true }
)

const accountResumes = computed(() =>
  allResumes.value.filter((resume) => resume.hhAccountId === accountId.value)
)

watch(accountId, () => {
  if (
    resumeSelection.value !== ACCOUNT_DEFAULT &&
    !accountResumes.value.some((resume) => resume.id === resumeSelection.value)
  ) {
    resumeSelection.value = ACCOUNT_DEFAULT
  }
})

const resumeId = computed<string | null>(() =>
  resumeSelection.value === ACCOUNT_DEFAULT ? null : resumeSelection.value
)

const viewQuery = useQuery({
  key: () => applyFilterKeys.get(accountId.value, resumeId.value),
  query: () => applyFilterApi.get({ hhAccountId: accountId.value, resumeId: resumeId.value }),
  enabled: () => accountId.value !== ""
})
const view = computed<ApplyFilterView | null>(() => viewQuery.data.value ?? null)

const applyPresets = computed(() => presets.value.filter((preset) => preset.kind === "apply"))
const otherPresets = computed(() => presets.value.filter((preset) => preset.kind !== "apply"))

const filter = ref(reactive(toEditable(undefined)))
const minFit = ref(45)
const tests = ref<TestsPolicy>("human")
const halfLife = ref(72)
const formError = ref<string | null>(null)
const notice = ref<string | null>(null)

/** The form follows what the server says applies to the selected pair. */
const load = (value: ApplyFilterView) => {
  filter.value = reactive(toEditable(value.filter))
  minFit.value = value.minFit
  tests.value = value.tests
  halfLife.value = value.freshHalfLifeHours
  formError.value = null
}
watch(view, (value) => value !== null && load(value), { immediate: true })

const incomplete = computed(() => allRules(filter.value).some((rule) => !isComplete(rule)))

const invalidate = () => queryCache.invalidateQueries({ key: applyFilterKeys.all })

const setMutation = useMutation({
  mutation: (_: void) =>
    applyFilterApi.set({
      hhAccountId: accountId.value,
      resumeId: resumeId.value,
      filter: buildFilter(filter.value),
      minFit: minFit.value,
      tests: tests.value,
      freshHalfLifeHours: halfLife.value
    }),
  onSuccess: invalidate
})

const presetMutation = useMutation({
  mutation: (_: void) =>
    applyFilterApi.fromPreset({
      hhAccountId: accountId.value,
      resumeId: resumeId.value,
      presetId: presetId.value
    }),
  onSuccess: invalidate
})

const save = async () => {
  notice.value = null
  if (!Number.isInteger(minFit.value) || minFit.value < 0 || minFit.value > 100) {
    formError.value = "Минимальное соответствие: целое число от 0 до 100."
    return
  }
  if (!Number.isInteger(halfLife.value) || halfLife.value < 1) {
    formError.value = "Период полураспада свежести: целое число часов, не меньше 1."
    return
  }
  formError.value = null
  try {
    await setMutation.mutateAsync()
    notice.value = "Фильтр сохранён."
  } catch {
    // Rendered from the mutation error.
  }
}

const fromPreset = async () => {
  if (presetId.value === "") return
  notice.value = null
  try {
    await presetMutation.mutateAsync()
    notice.value = "Правила скопированы из пресета. Дальнейшие правки пресета этот фильтр не изменят."
  } catch {
    // Rendered from the mutation error.
  }
}

const errorOf = (error: unknown) => (error === null ? null : describeError(error))
const loadError = computed(() => errorOf(viewQuery.error.value))
const saveError = computed(() => errorOf(setMutation.error.value))
const presetError = computed(() => errorOf(presetMutation.error.value))
const busy = computed(() => setMutation.isLoading.value || presetMutation.isLoading.value)

const templateTitle = computed(
  () => presets.value.find((preset) => preset.id === view.value?.templatePresetId)?.title ?? null
)

const sourceHint = computed(() => {
  const value = view.value
  if (value === null) return ""
  if (value.source === "exact") return ""
  if (value.source === "account")
    return resumeId.value === null
      ? ""
      : "Для этого резюме своего фильтра нет: действует фильтр аккаунта. Сохранение создаст отдельный фильтр резюме."
  return "Фильтр ещё не настроен: действует встроенный шаблон. Сохранение создаст запись."
})
</script>

<template>
  <section>
    <PageHeader
      title="Фильтр откликов"
      description="Жёсткие условия, по которым вакансия получает отклик: правила, порог соответствия и режим тестов."
    >
      <template #actions>
        <RefreshButton :loading="viewQuery.isLoading.value" @refresh="viewQuery.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="loadError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить фильтр</AlertTitle>
      <AlertDescription>{{ loadError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" variant="info" class="mb-4">
      <CircleAlert />
      <AlertTitle>Готово</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <Label class="text-xs">Аккаунт hh</Label>
        <Select v-model="accountId" :disabled="busy">
          <SelectTrigger class="h-8 w-[220px] text-sm"><SelectValue placeholder="Аккаунт" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
              {{ hhAccountName(account) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1">
        <Label class="text-xs">Резюме</Label>
        <Select v-model="resumeSelection" :disabled="busy">
          <SelectTrigger class="h-8 w-[280px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ACCOUNT_DEFAULT">Все резюме аккаунта (по умолчанию)</SelectItem>
            <SelectItem v-for="resume in accountResumes" :key="resume.id" :value="resume.id">
              {{ resume.title }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div v-if="view" class="flex items-center gap-2 pb-1">
        <Badge :variant="view.source === 'exact' ? 'default' : 'secondary'">
          {{ applyFilterSourceLabel(view.source) }}
        </Badge>
        <HelpHint :text="applyFilterHelp.source" label="источник фильтра" />
        <span v-if="view.updatedAt" class="text-xs text-muted-foreground">
          обновлён {{ formatDate(view.updatedAt) }}
        </span>
        <span v-if="templateTitle" class="text-xs text-muted-foreground">
          · скопирован из пресета «{{ templateTitle }}»
        </span>
      </div>
    </div>

    <p v-if="sourceHint" class="mb-4 text-xs text-muted-foreground">{{ sourceHint }}</p>

    <AutoApplySection :account-id="accountId" :resume-id="resumeId" :view="view" />

    <Card class="mb-4">
      <CardContent class="space-y-2 p-4">
        <h2 class="text-sm font-semibold">Начать с пресета</h2>
        <p class="text-xs text-muted-foreground">Готовый набор правил как отправная точка для фильтра.</p>
        <div class="flex flex-wrap items-center gap-2">
          <Select v-model="presetId" :disabled="busy">
            <SelectTrigger class="h-8 w-[280px] text-sm"><SelectValue placeholder="Выберите пресет" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="preset in applyPresets" :key="preset.id" :value="preset.id">
                {{ preset.title }}
              </SelectItem>
              <SelectItem v-for="preset in otherPresets" :key="preset.id" :value="preset.id">
                {{ preset.title }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" :disabled="busy || presetId === '' || accountId === ''" @click="fromPreset">
            <Copy class="h-4 w-4" />
            {{ presetMutation.isLoading.value ? "Копирую…" : "Скопировать правила" }}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Правила копируются в фильтр сразу и сохраняются. Позднее изменение пресета фильтр не затронет.
        </p>
        <Alert v-if="presetError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось применить пресет</AlertTitle>
          <AlertDescription>{{ presetError }}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="space-y-4 p-4">
        <Alert v-if="formError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Проверьте форму</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <Alert v-if="saveError" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось сохранить фильтр</AlertTitle>
          <AlertDescription>{{ saveError }}</AlertDescription>
        </Alert>

        <div>
          <div class="flex items-center gap-1">
            <h2 class="text-sm font-semibold">Правила фильтра</h2>
            <HelpHint :text="applyFilterHelp.rules" label="правила фильтра" />
            <HelpHint :text="applyFilterHelp.listValues" label="списки значений" />
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            Жёсткие условия: вакансия, не прошедшая их, отклика не получит.
          </p>
        </div>

        <RuleBuilder v-model="filter" :disabled="busy" />

        <div class="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <div class="space-y-1">
            <FieldLabel :hint="applyFilterHelp.minFit">Минимальный fit (0-100)</FieldLabel>
            <Input v-model.number="minFit" type="number" min="0" max="100" class="h-8" :disabled="busy" />
          </div>
          <div class="space-y-1">
            <FieldLabel :hint="applyFilterHelp.tests">Тестовые задания</FieldLabel>
            <Select v-model="tests" :disabled="busy">
              <SelectTrigger class="h-8 text-sm"><SelectValue /></SelectTrigger>
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

        <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" :disabled="busy || accountId === '' || view === null" @click="save">
            <Save class="h-4 w-4" />
            {{ setMutation.isLoading.value ? "Сохраняю…" : "Сохранить фильтр" }}
          </Button>
          <Button variant="ghost" size="sm" :disabled="busy || view === null" @click="view && load(view)">
            Сбросить правки
          </Button>
          <span v-if="incomplete" class="ml-auto text-xs text-muted-foreground">
            неполные правила не учитываются
          </span>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
