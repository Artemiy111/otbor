<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { RESUME_FAQ_TOPICS, SALARY_CURRENCIES } from "@otbor/contract"
import type { ResumeRecord } from "@otbor/contract"
import { CircleAlert, ExternalLink } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { presetApi, presetKeys } from "@/entities/preset"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { FilterTargetPicker, UnsavedChangesSheet, useFilterTarget, useUnsavedGuard } from "@/features/filter-target"
import type { FilterTarget } from "@/features/filter-target"
import { RefreshButton } from "@/features/refresh-button"
import { cn, currencySymbol, describeError, formatDate, toneClasses } from "@/shared/lib"
import type { HighlightTerm } from "@/shared/ui"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AmountInput,
  Badge,
  Button,
  EmptyState,
  HighlightedText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import {
  buildSavePayload,
  draftFromEnrichment,
  emptyDraft,
  isSectionDirty,
  newCustomFaqId,
  revertSection,
  SECTIONS,
  type EnrichmentDraft,
  type ExperienceItem,
  type Section
} from "../model/enrichment-draft"
import ResumeSection from "./ResumeSection.vue"

/* Выбор «аккаунт + резюме»: общий с автооткликами и фильтром, лежит в ?account=&resume= */
const filterTarget = useFilterTarget()
const { accounts, resumes, resume: selectedResume, accountId: selectedAccountId, resumeId: selectedResumeId } = filterTarget
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

// Страница показывает одно резюме: «все резюме аккаунта» заменяется первым.
watch(
  [selectedAccountId, selectedResumeId, resumes],
  () => {
    if (selectedAccountId.value === "" || selectedResumeId.value !== null) return
    const first = resumes.value[0]
    if (first) filterTarget.select({ accountId: selectedAccountId.value, resumeId: first.id })
  },
  { immediate: true }
)

const enrichmentQuery = useQuery({
  key: () => resumeKeys.enrichment(selectedResume.value?.id ?? ""),
  query: () => resumeApi.enrichmentGet(selectedResume.value!.id),
  enabled: () => selectedResume.value !== null
})

/* Подсветка слов словаря в тексте резюме ------------------------------------ */

const showFullText = ref(false)
const highlightPresetId = ref("all")
const skillThreshold = ref<string | number>(10)
const keywordThreshold = ref<string | number>(20)
const presetsQuery = useQuery({ key: () => presetKeys.list("all"), query: () => presetApi.list({}) })
const keywordsQuery = useQuery({
  key: () => keywordKeys.list("", highlightPresetId.value, "any"),
  query: () =>
    keywordApi.list({
      limit: 5000,
      presetId: highlightPresetId.value === "all" ? undefined : highlightPresetId.value
    })
})
/** A threshold input as a whole number of at least `min`; an empty field is `min`. */
const thresholdOf = (value: string | number, min: number): number => Math.max(min, Math.trunc(Number(value)) || min)
const skillLimit = computed(() => thresholdOf(skillThreshold.value, 1))
const keywordLimit = computed(() => thresholdOf(keywordThreshold.value, 0))
/**
 * Red: a keyword that at least `skillLimit` vacancies list among their hh skills.
 * Yellow: any other keyword that occurs in the text of at least `keywordLimit` vacancies
 * (0 keeps every keyword of the lexicon, even one no vacancy mentions).
 */
const highlightTerms = computed<ReadonlyArray<HighlightTerm>>(() =>
  (keywordsQuery.data.value ?? []).flatMap((keyword) => {
    const kind =
      keyword.skillVacancyCount >= skillLimit.value
        ? "skill"
        : keyword.vacancyCount >= keywordLimit.value
          ? "keyword"
          : null
    if (kind === null) return []
    return [keyword.term, ...keyword.aliases.map((a) => a.alias)].map(
      (text) => ({ text, kind, vacancies: keyword.vacancyCount, skillVacancies: keyword.skillVacancyCount }) as const
    )
  })
)

/* Места работы из резюме ---------------------------------------------------- */

const str = (value: unknown): string => (typeof value === "string" ? value : "")
const experienceItems = computed(() =>
  (selectedResume.value?.experience ?? []).map((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>
    const company = str(e.companyName) || str(e.company)
    const position = str(e.position)
    const start = str(e.startDate)
    const end = str(e.endDate)
    const key = [company, position].filter(Boolean).join(" ").toLowerCase()
    return {
      key,
      // Notes saved before the key was exact matched by substring; keep reading them.
      matches: (stored: string) => stored !== "" && stored !== key && key.includes(stored.toLowerCase()),
      title: [position, company].filter(Boolean).join(" — ") || "Место работы",
      period: start || end ? `${start || "?"} — ${end || "по настоящее время"}` : "",
      description: str(e.description)
    }
  })
)
const experienceKeys = computed<ReadonlyArray<ExperienceItem>>(() => experienceItems.value)

/* Черновик и разделы --------------------------------------------------------- */

/** Сохранённое на сервере, в виде черновика; пока карточка не пришла, `null`. */
const saved = computed<EnrichmentDraft | null>(() => {
  const data = enrichmentQuery.data.value
  const resume = selectedResume.value
  if (!data || !resume || data.resumeId !== resume.id) return null
  return draftFromEnrichment(data, experienceKeys.value)
})
const draft = ref<EnrichmentDraft>(emptyDraft())

const dirty = computed<Record<Section, boolean>>(() => {
  const base = saved.value
  const state = { notes: false, salary: false, faq: false }
  if (!base) return state
  for (const section of SECTIONS) state[section] = isSectionDirty(section, draft.value, base, experienceKeys.value)
  return state
})
const anyDirty = computed(() => SECTIONS.some((section) => dirty.value[section]))

// Форма следует за сервером, пока нет несохранённых правок; смена резюме грузит заново.
let loadedFor = ""
watch(
  [saved, () => selectedResume.value?.id ?? ""],
  ([value, id]) => {
    if (!value) return
    if (loadedFor !== id || !anyDirty.value) {
      draft.value = structuredClone(value)
      loadedFor = id
    }
  },
  { immediate: true }
)

const { open: guardOpen, confirmThen, leave: guardLeave, stay: guardStay } = useUnsavedGuard(anyDirty)
const onSelect = (next: FilterTarget) => confirmThen(() => filterTarget.select(next))

const queryCache = useQueryCache()
const toast = useToast()
const savingSection = ref<Section | null>(null)

const SECTION_TITLE: Record<Section, string> = {
  notes: "Заметки о работе",
  salary: "Зарплатные ожидания",
  faq: "Ответы на частые вопросы"
}

const saveSection = async (section: Section) => {
  const resume = selectedResume.value
  if (!resume) return
  savingSection.value = section
  try {
    await resumeApi.enrichmentSave(
      resume.id,
      buildSavePayload(section, draft.value, enrichmentQuery.data.value, experienceKeys.value)
    )
    await queryCache.invalidateQueries({ key: resumeKeys.enrichment(resume.id) })
    toast.success("Сохранено", { description: SECTION_TITLE[section] })
  } catch (error) {
    toast.error("Не удалось сохранить", { description: `${SECTION_TITLE[section]}: ${describeError(error)}` })
  } finally {
    savingSection.value = null
  }
}
const revert = (section: Section) => {
  if (saved.value) draft.value = revertSection(section, draft.value, saved.value)
}

/* Поля разделов --------------------------------------------------------------- */

const addCustomFaq = () => draft.value.customFaq.push({ id: newCustomFaqId(), question: "", answer: "" })
const removeCustomFaq = (id: number) => {
  draft.value.customFaq = draft.value.customFaq.filter((entry) => entry.id !== id)
}

/**
 * What the resume already says about a FAQ topic, shown under an empty field.
 * Only topics the imported resume really carries: work formats and an English mention.
 */
const FORMAT_LABELS: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", office: "офис", on_site: "офис" }
const RELOCATION_LABELS: Record<string, string> = {
  no_relocation: "не готов",
  relocation_possible: "возможен",
  relocation_desirable: "желателен"
}
const TRIP_LABELS: Record<string, string> = { never: "не готов", sometimes: "иногда", ready: "готов" }
const resumeHint = (key: string): string | null => {
  const r = selectedResume.value
  if (!r) return null
  if (key === "office" && r.workFormats.length) {
    return `формат работы: ${r.workFormats.map((f) => FORMAT_LABELS[f.toLowerCase()] ?? f).join(", ")}`
  }
  if (key === "city" && r.areaName) return `город в резюме: ${r.areaName}`
  if (key === "relocation" && r.relocation) return `переезд в резюме: ${RELOCATION_LABELS[r.relocation] ?? r.relocation}`
  if (key === "business_trips" && r.businessTripReadiness) {
    return `командировки в резюме: ${TRIP_LABELS[r.businessTripReadiness] ?? r.businessTripReadiness}`
  }
  if (key === "english_level") {
    if (r.englishLevel) return `английский в резюме: ${r.englishLevel}`
    const mention = [...r.skills, ...r.text.split(/\n+/)].find((line) => /англий|english/i.test(line))
    return mention ? mention.trim().slice(0, 120) : null
  }
  return null
}
const emptyHint = (key: string, value: string | undefined): string | null =>
  (value ?? "").trim() === "" ? resumeHint(key) : null

/** Что резюме говорит о себе само: город, переезд, командировки, английский. */
const resumeFacts = computed(() => {
  const r = selectedResume.value
  if (!r) return []
  const rows: Array<readonly [string, string | null]> = [
    ["Город", r.areaName ?? null],
    ["Формат работы", r.workFormats.length ? r.workFormats.map((f) => FORMAT_LABELS[f.toLowerCase()] ?? f).join(", ") : null],
    ["Переезд", r.relocation ? (RELOCATION_LABELS[r.relocation] ?? r.relocation) : null],
    ["Командировки", r.businessTripReadiness ? (TRIP_LABELS[r.businessTripReadiness] ?? r.businessTripReadiness) : null],
    ["Английский", r.englishLevel ?? null]
  ]
  return rows.flatMap(([term, value]) => (value === null ? [] : [[term, value] as const]))
})

const aiSalaries = computed(() => {
  const parts = SALARY_CURRENCIES.flatMap((currency) => {
    const d = draft.value.salaries[currency]
    const bits = [d.expectation && `ожидает ${d.expectation}`, d.min && `минимум ${d.min}`].filter(Boolean)
    return bits.length ? [`${currencySymbol(currency)}: ${bits.join(", ")}`] : []
  })
  if (parts.length) return parts.join(" · ")
  const r = selectedResume.value
  return r?.salaryAmount ? `в резюме ${r.salaryAmount} ${currencySymbol(r.salaryCurrency ?? "")}` : "не указана"
})

/* Загрузка резюме с hh ---------------------------------------------------------- */

const syncMessage = ref("")
const syncMutation = useMutation({
  mutation: async () => {
    const accountId = selectedAccountId.value
    let status = await resumeApi.syncRun(accountId)
    const accountName = accounts.value.find((a) => a.id === accountId)?.label ?? "выбранного аккаунта"
    syncMessage.value = `Загружаю резюме аккаунта «${accountName}». Задачу выполняет браузерный harness, жду его…`
    const deadline = Date.now() + 180_000
    while (!["done", "failed", "needs_human"].includes(status.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      status = await resumeApi.syncStatus(accountId)
    }
    const c = status.counts
    syncMessage.value =
      status.status === "done" && c
        ? `Найдено ${c.found}: новых ${c.imported}, обновлено ${c.updated}, без изменений ${c.unchanged}, не прочитано ${c.unreadable}`
        : status.status === "pending"
          ? "Harness не взял задачу за 3 минуты. Он, скорее всего, не запущен: выполните `otbor harness run` и нажмите кнопку ещё раз."
          : `Статус: ${status.status}${status.message ? ` — ${status.message}` : ""}`
    return status
  },
  onSuccess(status) {
    if (status.status === "done") toast.success("Резюме обновлены с hh")
    else toast.warning("Загрузка резюме не завершилась", { description: "Что именно случилось, написано под кнопкой." })
  },
  onError(error) {
    toast.error("Не удалось загрузить резюме", { description: describeError(error) })
  },
  onSettled() {
    void resumesQuery.refetch()
  }
})

const refresh = () => {
  void resumesQuery.refetch()
  void enrichmentQuery.refetch()
}

const NAV: ReadonlyArray<{ id: string; label: string; section?: Section }> = [
  { id: "resume-hh", label: "С hh" },
  { id: "resume-ai", label: "Что видит ИИ" },
  { id: "resume-notes", label: "Заметки о работе", section: "notes" },
  { id: "resume-salary", label: "Зарплатные ожидания", section: "salary" },
  { id: "resume-faq", label: "Ответы на частые вопросы", section: "faq" }
]
const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })

/** Резюме для разметки внутри `v-else-if="selectedResume"`: там оно точно есть. */
const current = computed(() => selectedResume.value as ResumeRecord)

const loading = computed(() => filterTarget.loading.value || resumesQuery.isPending.value)
</script>

<template>
  <section>
    <PageHeader title="Резюме" description="Резюме с hh.ru и то, что вы добавляете для сопроводительных писем и анкет.">
      <template #actions>
        <Button v-if="selectedAccountId" variant="outline" as="a" :href="filterTarget.pathWithTarget('/apply-filter')">
          Фильтр откликов
        </Button>
        <Button
          variant="outline"
          :disabled="syncMutation.isLoading.value || !selectedAccountId"
          title="Заново читает резюме выбранного аккаунта с hh.ru"
          @click="syncMutation.mutate()"
        >
          {{ syncMutation.isLoading.value ? "Загружаю…" : "Обновить с hh" }}
        </Button>
        <RefreshButton :loading="resumesQuery.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <p v-if="syncMessage" class="mb-4 text-sm text-muted-foreground">{{ syncMessage }}</p>

    <Alert v-if="resumesQuery.error.value || filterTarget.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить резюме</AlertTitle>
      <AlertDescription>{{ describeError(resumesQuery.error.value ?? filterTarget.error.value) }}</AlertDescription>
    </Alert>

    <FilterTargetPicker class="mb-6" :state="filterTarget" :disabled="savingSection !== null" @select="onSelect" />

    <div v-if="loading" class="space-y-4">
      <Skeleton class="h-40 rounded-xl" />
      <Skeleton class="h-64 rounded-xl" />
    </div>

    <div v-else-if="selectedResume" class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_13rem]">
      <div class="min-w-0 space-y-4">
        <!-- С hh -->
        <ResumeSection id="resume-hh" title="С hh" description="Так резюме выглядит на hh.ru. Эти данные не редактируются здесь, они загружаются с hh.">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <h3 class="text-lg font-semibold leading-tight">{{ current.title }}</h3>
              <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <Badge :variant="current.isActive ? 'success' : 'neutral'">
                  {{ current.isActive ? "Активно" : "Неактивно" }}
                </Badge>
                <span class="tabular-nums">обновлено {{ formatDate(current.updatedAt) }}</span>
              </p>
            </div>
            <Button variant="outline" size="sm" as="a" :href="`https://hh.ru/resume/${current.externalId}`" target="_blank" rel="noopener">
              Открыть на hh.ru <ExternalLink />
            </Button>
          </div>
          <dl v-if="resumeFacts.length" class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div v-for="[term, value] in resumeFacts" :key="term" class="flex gap-2">
              <dt class="w-28 shrink-0 text-muted-foreground">{{ term }}</dt>
              <dd class="min-w-0">{{ value }}</dd>
            </div>
          </dl>
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Полный текст резюме</h3>
              <Button variant="outline" size="sm" :aria-expanded="showFullText" @click="showFullText = !showFullText">
                {{ showFullText ? "Скрыть" : "Показать" }}
              </Button>
            </div>
            <pre v-if="showFullText" class="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 text-sm"><HighlightedText :text="current.text" :terms="highlightTerms" /></pre>
          </div>
        </ResumeSection>

        <!-- Что видит ИИ -->
        <ResumeSection
          id="resume-ai"
          title="Что видит ИИ"
          description="Из чего составляются письма и ответы: данные резюме плюс ваши заметки. Слова из словаря подсвечены, чтобы видеть, что востребовано в вакансиях."
        >
          <div class="flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-3">
            <div class="space-y-1.5">
              <Label for="highlight-preset" class="text-xs text-muted-foreground">Вакансии для подсветки</Label>
              <Select v-model="highlightPresetId">
                <SelectTrigger id="highlight-preset" class="w-[240px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все вакансии</SelectItem>
                  <SelectItem v-for="preset in presetsQuery.data.value ?? []" :key="preset.id" :value="preset.id">
                    {{ preset.title }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="highlight-threshold" class="text-xs text-muted-foreground">Навык красным от, вакансий</Label>
              <Input id="highlight-threshold" v-model="skillThreshold" type="number" min="1" class="w-[120px]" />
            </div>
            <div class="space-y-1.5">
              <Label for="highlight-keyword-threshold" class="text-xs text-muted-foreground">Слово жёлтым от, вакансий</Label>
              <Input id="highlight-keyword-threshold" v-model="keywordThreshold" type="number" min="0" class="w-[120px]" />
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            В тексте подсвечено:
            <mark class="rounded-sm bg-warning/25 px-1 text-foreground">слово из ≥ {{ keywordLimit }} вакансий</mark>
            <mark class="ml-1 rounded-sm bg-danger/25 px-1 text-foreground">навык hh из ≥ {{ skillLimit }} вакансий</mark>
          </p>
          <dl class="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt class="text-muted-foreground">Зарплата</dt>
            <dd class="tabular-nums">{{ aiSalaries }}</dd>
            <dt class="text-muted-foreground">Формат работы</dt>
            <dd>{{ current.workFormats.length ? current.workFormats.join(", ") : "не указан" }}</dd>
            <dt class="text-muted-foreground">Навыки</dt>
            <dd class="flex flex-wrap gap-1">
              <Badge v-for="skill in current.skills" :key="skill" variant="secondary">{{ skill }}</Badge>
              <span v-if="!current.skills.length">не указаны</span>
            </dd>
            <dt class="text-muted-foreground">О себе</dt>
            <dd class="whitespace-pre-wrap"><HighlightedText v-if="current.about" :text="current.about" :terms="highlightTerms" /><template v-else>нет</template></dd>
            <dt class="text-muted-foreground">Ваши заметки</dt>
            <dd class="whitespace-pre-wrap">{{ draft.comment || "нет" }}</dd>
          </dl>
          <p v-if="anyDirty" class="text-xs text-muted-foreground">Здесь учтены и ещё не сохранённые правки ниже.</p>
        </ResumeSection>

        <div v-if="enrichmentQuery.isPending.value" class="space-y-4">
          <Skeleton class="h-56 rounded-xl" />
          <Skeleton class="h-40 rounded-xl" />
        </div>
        <Alert v-else-if="enrichmentQuery.error.value" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось загрузить ваши дополнения к резюме</AlertTitle>
          <AlertDescription>{{ describeError(enrichmentQuery.error.value) }}</AlertDescription>
        </Alert>
        <template v-else>
          <!-- Заметки о работе -->
          <ResumeSection
            id="resume-notes"
            title="Заметки о работе"
            description="Подсказки для ИИ: что вы хотите сказать о местах работы. Это не готовый текст письма."
            editable
            :dirty="dirty.notes"
            :saving="savingSection === 'notes'"
            @save="saveSection('notes')"
            @revert="revert('notes')"
          >
            <div class="space-y-1.5">
              <Label for="employment">Работаю ли я сейчас</Label>
              <Select v-model="draft.employment">
                <SelectTrigger id="employment" class="w-full max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Определить по резюме</SelectItem>
                  <SelectItem value="employed">Работаю: «на текущем месте»</SelectItem>
                  <SelectItem value="unemployed">Не работаю: «на прошлом месте»</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">
                По умолчанию: если у последнего места нет даты окончания, работаю. Это попадает в письмо.
              </p>
            </div>
            <div class="space-y-1.5">
              <Label for="resume-comment">Общие заметки о резюме</Label>
              <Textarea id="resume-comment" v-model="draft.comment" rows="3" />
            </div>
            <div v-if="experienceItems.length" class="space-y-2">
              <h3 class="text-sm font-semibold">По местам работы</h3>
              <ul class="space-y-3">
                <li v-for="item in experienceItems" :key="item.key" class="rounded-md border p-3 text-sm">
                  <div class="font-medium">{{ item.title }}</div>
                  <div v-if="item.period" class="text-xs tabular-nums text-muted-foreground">{{ item.period }}</div>
                  <p v-if="item.description" class="mt-1 whitespace-pre-wrap text-muted-foreground"><HighlightedText :text="item.description" :terms="highlightTerms" /></p>
                  <div class="mt-2 space-y-1.5">
                    <Label :for="`note-${item.key}`">Заметка для ИИ</Label>
                    <Textarea
                      :id="`note-${item.key}`"
                      v-model="draft.jobNotes[item.key]"
                      rows="2"
                      placeholder="Формат работы, причина ухода, что подчеркнуть"
                    />
                  </div>
                </li>
              </ul>
            </div>
          </ResumeSection>

          <!-- Зарплатные ожидания -->
          <ResumeSection
            id="resume-salary"
            title="Зарплатные ожидания"
            description="Пустая валюта — не рассматриваю. Сумма берётся в валюте вакансии, без пересчёта."
            editable
            :dirty="dirty.salary"
            :saving="savingSection === 'salary'"
            @save="saveSection('salary')"
            @revert="revert('salary')"
          >
            <div class="grid max-w-md grid-cols-[2rem_1fr_1fr] items-center gap-x-3 gap-y-2 text-sm">
              <span />
              <span class="text-xs text-muted-foreground">Минимум</span>
              <span class="text-xs text-muted-foreground">Ожидаемая</span>
              <template v-for="currency in SALARY_CURRENCIES" :key="currency">
                <Label :for="`min-${currency}`" class="font-medium">{{ currencySymbol(currency) }}</Label>
                <AmountInput :id="`min-${currency}`" v-model="draft.salaries[currency].min" class="h-8" placeholder="0" />
                <AmountInput v-model="draft.salaries[currency].expectation" class="h-8" placeholder="0" :aria-label="`Ожидаемая зарплата, ${currencySymbol(currency)}`" />
              </template>
            </div>
          </ResumeSection>

          <!-- Ответы на частые вопросы -->
          <ResumeSection
            id="resume-faq"
            title="Ответы на частые вопросы"
            description="Как отвечать на вопросы, которые встречаются в анкетах работодателей. Это подсказка ИИ, а не готовый текст."
            editable
            :dirty="dirty.faq"
            :saving="savingSection === 'faq'"
            @save="saveSection('faq')"
            @revert="revert('faq')"
          >
            <div class="grid gap-4 md:grid-cols-2">
              <div v-for="topic in RESUME_FAQ_TOPICS" :key="topic.key" class="space-y-1.5">
                <Label :for="`faq-${topic.key}`">{{ topic.question }}</Label>
                <Input v-if="'short' in topic" :id="`faq-${topic.key}`" v-model="draft.faqAnswers[topic.key]" />
                <Textarea v-else :id="`faq-${topic.key}`" v-model="draft.faqAnswers[topic.key]" rows="2" />
                <p v-if="emptyHint(topic.key, draft.faqAnswers[topic.key])" class="text-xs text-muted-foreground">
                  Не заполнено, ИИ возьмёт из резюме: {{ emptyHint(topic.key, draft.faqAnswers[topic.key]) }}
                </p>
              </div>
            </div>
            <div v-if="draft.customFaq.length" class="space-y-3">
              <h3 class="text-sm font-semibold">Свои вопросы</h3>
              <div v-for="entry in draft.customFaq" :key="entry.id" class="space-y-1.5 rounded-md border p-3">
                <Input v-model="entry.question" placeholder="Вопрос" aria-label="Вопрос" />
                <Textarea v-model="entry.answer" rows="2" placeholder="Как отвечать" aria-label="Как отвечать" />
                <Button variant="ghost" size="sm" @click="removeCustomFaq(entry.id)">Удалить</Button>
              </div>
            </div>
            <Button variant="outline" size="sm" @click="addCustomFaq">Добавить свой вопрос</Button>
          </ResumeSection>
        </template>
      </div>

      <!-- Оглавление: видно, где есть несохранённые правки -->
      <nav class="sticky top-20 hidden lg:block" aria-label="Разделы страницы">
        <ul class="space-y-0.5 border-l text-sm">
          <li v-for="item in NAV" :key="item.id">
            <button
              type="button"
              class="-ml-px flex w-full items-center gap-2 border-l border-transparent py-1 pl-3 text-left text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="goTo(item.id)"
            >
              <span>{{ item.label }}</span>
              <span
                v-if="item.section && dirty[item.section]"
                :class="cn('size-2 shrink-0 rounded-full', toneClasses('warning').dot)"
                title="Есть несохранённые правки"
              />
            </button>
          </li>
        </ul>
      </nav>
    </div>

    <EmptyState
      v-else
      title="У этого аккаунта нет резюме"
      description="Нажмите «Обновить с hh», чтобы загрузить резюме аккаунта с hh.ru."
    />

    <UnsavedChangesSheet :open="guardOpen" @leave="guardLeave" @stay="guardStay" />
  </section>
</template>
