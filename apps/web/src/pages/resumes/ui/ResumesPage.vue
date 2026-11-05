<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { RESUME_FAQ_TOPICS, SALARY_CURRENCIES } from "@otbor/contract"
import type { HhAccountRecord, ResumeEnrichment, ResumeRecord, SalaryCurrency } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { hhAccountApi, hhAccountKeys, useDefaultAccount } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { AccountResumePicker } from "@/features/vacancy-apply"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
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
  Textarea
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
const { defaultAccountId } = useDefaultAccount()
const selectedAccountId = ref<string>("")
watch(defaultAccountId, (id) => {
  if (id !== undefined) selectedAccountId.value = id
}, { immediate: true })
watch(accounts, (list) => {
  if (selectedAccountId.value === "" && list.length > 0) {
    const def = list.find((a) => a.isDefault) ?? list[0]
    if (def) selectedAccountId.value = def.id
  }
}, { immediate: true })

const resumesQuery = useQuery({
  key: () => resumeKeys.list(),
  query: () => resumeApi.list()
})
const allResumes = computed<ReadonlyArray<ResumeRecord>>(() => resumesQuery.data.value ?? [])
const resumes = computed(() => allResumes.value.filter((r) => r.hhAccountId === selectedAccountId.value))
const selectedResumeId = ref<string>("")
watch(resumes, (list) => {
  if (selectedResumeId.value === "" && list.length > 0) selectedResumeId.value = list[0]!.id
  if (list.length > 0 && !list.some((r) => r.id === selectedResumeId.value)) selectedResumeId.value = list[0]!.id
}, { immediate: true })

const selectedResume = computed(() => resumes.value.find((r) => r.id === selectedResumeId.value) ?? null)

const enrichmentQuery = useQuery({
  key: () => resumeKeys.enrichment(selectedResumeId.value),
  query: () => (selectedResumeId.value ? resumeApi.enrichmentGet(selectedResumeId.value) : Promise.resolve(null as unknown as ResumeEnrichment)),
  enabled: () => selectedResumeId.value !== ""
})

const comment = ref("")

interface SalaryDraft { min: string; expectation: string }
const emptySalaries = (): Record<SalaryCurrency, SalaryDraft> =>
  Object.fromEntries(SALARY_CURRENCIES.map((c) => [c, { min: "", expectation: "" }])) as Record<SalaryCurrency, SalaryDraft>
const salaries = ref<Record<SalaryCurrency, SalaryDraft>>(emptySalaries())

const faqAnswers = ref<Record<string, string>>({})
interface CustomFaq { id: number; question: string; answer: string }
const customFaq = ref<CustomFaq[]>([])
let customFaqId = 0
const addCustomFaq = () => customFaq.value.push({ id: ++customFaqId, question: "", answer: "" })
const removeCustomFaq = (id: number) => { customFaq.value = customFaq.value.filter((e) => e.id !== id) }

const jobNotes = ref<Record<string, string>>({})

const topicKeys: ReadonlyArray<string> = RESUME_FAQ_TOPICS.map((t) => t.key)
const amountText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value))

watch(enrichmentQuery.data, (data) => {
  if (!data) return
  comment.value = data.comment ?? ""
  const next = emptySalaries()
  for (const slot of data.salaries ?? []) {
    next[slot.currency] = { min: amountText(slot.min), expectation: amountText(slot.expectation) }
  }
  salaries.value = next
  faqAnswers.value = Object.fromEntries((data.faq ?? []).filter((e) => topicKeys.includes(e.key)).map((e) => [e.key, e.answer]))
  customFaq.value = (data.faq ?? [])
    .filter((e) => !topicKeys.includes(e.key))
    .map((e) => ({ id: ++customFaqId, question: e.question ?? "", answer: e.answer }))
  jobNotes.value = Object.fromEntries(
    (data.experience ?? []).filter((e) => e.key !== "").map((e) => [e.key, e.comment ?? ""])
  )
}, { immediate: true })

/**
 * What the resume already says about a FAQ topic, shown under an empty field.
 * Only topics the imported resume really carries: work formats and an English mention.
 */
const FORMAT_LABELS: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", office: "офис", on_site: "офис" }
const resumeHint = (key: string): string | null => {
  const r = selectedResume.value
  if (!r) return null
  if (key === "office" && r.workFormats.length) {
    return `формат работы: ${r.workFormats.map((f) => FORMAT_LABELS[f.toLowerCase()] ?? f).join(", ")}`
  }
  if (key === "english_level") {
    const mention = [...r.skills, ...r.text.split(/\n+/)].find((line) => /англий|english/i.test(line))
    return mention ? mention.trim().slice(0, 120) : null
  }
  return null
}
const emptyHint = (key: string, value: string | undefined): string | null =>
  (value ?? "").trim() === "" ? resumeHint(key) : null

const toAmount = (value: string): number | null => {
  const n = Number(value.replace(/\s+/g, ""))
  return value.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null
}

const queryCache = useQueryCache()
const saveMutation = useMutation({
  mutation: () => {
    const saved = enrichmentQuery.data.value?.experience ?? []
    const shownKeys = new Set(experienceItems.value.map((i) => i.key))
    const experience = [
      // Notes for jobs that are no longer in the imported resume stay as they were.
      ...saved.filter((e) => !shownKeys.has(e.key) && !experienceItems.value.some((i) => i.matches(e.key))),
      ...experienceItems.value.flatMap((item) => {
        const old = saved.find((e) => e.key === item.key || item.matches(e.key))
        const note = (jobNotes.value[item.key] ?? "").trim()
        if (note === "" && !old?.employmentType && !old?.leaveReason) return []
        return [{
          key: item.key,
          employmentType: old?.employmentType ?? null,
          comment: note === "" ? null : note,
          leaveReason: old?.leaveReason ?? null
        }]
      })
    ]
    return resumeApi.enrichmentSave(selectedResumeId.value, {
      comment: comment.value,
      salaries: SALARY_CURRENCIES.flatMap((currency) => {
        const draft = salaries.value[currency]
        const min = toAmount(draft.min)
        const expectation = toAmount(draft.expectation)
        return min === null && expectation === null ? [] : [{ currency, min, expectation }]
      }),
      faq: [
        ...RESUME_FAQ_TOPICS.map((t) => ({ key: t.key, answer: faqAnswers.value[t.key] ?? "" })),
        ...customFaq.value.map((e) => ({ key: `custom:${e.id}`, question: e.question.trim(), answer: e.answer }))
      ].filter((e) => e.answer.trim() !== ""),
      experience
    })
  },
  onSuccess() {
    void queryCache.invalidateQueries({ key: resumeKeys.enrichment(selectedResumeId.value) })
  }
})

const save = () => saveMutation.mutate()

const aiSalaries = computed(() => {
  const parts = SALARY_CURRENCIES.flatMap((currency) => {
    const d = salaries.value[currency]
    const bits = [d.expectation && `ожидает ${d.expectation}`, d.min && `минимум ${d.min}`].filter(Boolean)
    return bits.length ? [`${currency}: ${bits.join(", ")}`] : []
  })
  if (parts.length) return parts.join(" · ")
  const r = selectedResume.value
  return r?.salaryAmount ? `в резюме ${r.salaryAmount} ${r.salaryCurrency ?? ""}` : "не указана"
})

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

// Show a note saved under an older, shorter key in the field of the job it belongs to.
watch([experienceItems, enrichmentQuery.data], () => {
  for (const item of experienceItems.value) {
    if (item.key in jobNotes.value) continue
    const old = enrichmentQuery.data.value?.experience.find((x) => item.matches(x.key))
    if (old?.comment) jobNotes.value = { ...jobNotes.value, [item.key]: old.comment }
  }
})

const syncMessage = ref("")
const syncMutation = useMutation({
  mutation: async () => {
    const accountId = selectedAccountId.value
    let status = await resumeApi.syncRun(accountId)
    syncMessage.value = "Задача поставлена в очередь, жду гарнесс…"
    const deadline = Date.now() + 180_000
    while (!["done", "failed", "needs_human"].includes(status.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      status = await resumeApi.syncStatus(accountId)
    }
    const c = status.counts
    syncMessage.value =
      status.status === "done" && c
        ? `Найдено ${c.found}: новых ${c.imported}, обновлено ${c.updated}, без изменений ${c.unchanged}, не прочитано ${c.unreadable}`
        : `Статус: ${status.status}${status.message ? ` — ${status.message}` : ""}`
    return status
  },
  onSettled() {
    void resumesQuery.refetch()
  }
})

const refresh = () => {
  void resumesQuery.refetch()
  void enrichmentQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader title="Резюме" description="Резюме hh.ru и локальные дополнения для сопроводительных писем.">
      <template #actions>
        <Button variant="outline" :disabled="syncMutation.isLoading.value || !selectedAccountId" @click="syncMutation.mutate()">
          {{ syncMutation.isLoading.value ? "Загружаю…" : "Загрузить с hh" }}
        </Button>
        <RefreshButton :loading="resumesQuery.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <p v-if="syncMessage" class="mb-4 text-sm text-muted-foreground">{{ syncMessage }}</p>

    <Alert v-if="resumesQuery.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить резюме</AlertTitle>
      <AlertDescription>{{ describeError(resumesQuery.error.value) }}</AlertDescription>
    </Alert>

    <AccountResumePicker
      v-model:account-id="selectedAccountId"
      v-model:resume-id="selectedResumeId"
      class="mb-4 max-w-xl"
      :accounts="accounts"
      :resumes="allResumes"
    />

    <div>
      <Card v-if="selectedResume">
        <CardHeader>
          <CardTitle>{{ selectedResume.title }}</CardTitle>
          <CardDescription>
            {{ [selectedResume.status, selectedResume.isActive ? "активно" : "неактивно", `обновлено ${formatDate(selectedResume.updatedAt)}`].filter(Boolean).join(" · ") }}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-4 rounded-md border p-4">
            <h3 class="text-sm font-semibold">Что видит ИИ</h3>
            <dl class="grid gap-3 text-sm sm:grid-cols-[160px_1fr]">
              <dt class="text-muted-foreground">Зарплата</dt>
              <dd>{{ aiSalaries }}</dd>
              <dt class="text-muted-foreground">Формат работы</dt>
              <dd>{{ selectedResume.workFormats.length ? selectedResume.workFormats.join(", ") : "не указан" }}</dd>
              <dt class="text-muted-foreground">Навыки</dt>
              <dd class="flex flex-wrap gap-1">
                <Badge v-for="skill in selectedResume.skills" :key="skill" variant="secondary">{{ skill }}</Badge>
                <span v-if="!selectedResume.skills.length">не указаны</span>
              </dd>
              <dt class="text-muted-foreground">О себе</dt>
              <dd class="whitespace-pre-wrap">{{ selectedResume.about || "нет" }}</dd>
              <dt class="text-muted-foreground">Заметки оператора</dt>
              <dd class="whitespace-pre-wrap">{{ comment || "нет" }}</dd>
            </dl>
          </div>
          <div class="space-y-2">
            <h3 class="text-sm font-semibold">Полный текст резюме</h3>
            <pre class="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 text-sm">{{ selectedResume.text }}</pre>
          </div>
          <div v-if="experienceItems.length" class="space-y-2">
            <h3 class="text-sm font-semibold">Опыт работы</h3>
            <ul class="space-y-3">
              <li v-for="item in experienceItems" :key="item.key" class="rounded-md border p-3 text-sm">
                <div class="font-medium">{{ item.title }}</div>
                <div v-if="item.period" class="text-muted-foreground">{{ item.period }}</div>
                <p v-if="item.description" class="mt-1 whitespace-pre-wrap">{{ item.description }}</p>
                <div class="mt-2 space-y-1.5">
                  <Label>Заметка для агента</Label>
                  <Textarea v-model="jobNotes[item.key]" rows="2" placeholder="Формат работы, причина ухода, что подчеркнуть" />
                </div>
              </li>
            </ul>
          </div>
          <div class="space-y-2">
            <h3 class="text-sm font-semibold">Зарплата</h3>
            <p class="text-xs text-muted-foreground">Оставьте валюту пустой, если не рассматриваете её. Агент берёт сумму в валюте вакансии и не пересчитывает.</p>
            <div class="grid grid-cols-[4rem_1fr_1fr] items-center gap-2 text-sm">
              <span />
              <span class="text-muted-foreground">Минимум</span>
              <span class="text-muted-foreground">Ожидаемая</span>
              <template v-for="currency in SALARY_CURRENCIES" :key="currency">
                <Label :for="`min-${currency}`" class="font-medium">{{ currency }}</Label>
                <Input :id="`min-${currency}`" v-model="salaries[currency].min" type="number" min="0" />
                <Input v-model="salaries[currency].expectation" type="number" min="0" />
              </template>
            </div>
          </div>
          <div class="space-y-3">
            <h3 class="text-sm font-semibold">Частые вопросы в тестах</h3>
            <p class="text-xs text-muted-foreground">Как отвечать на вопросы, которые встречаются в анкетах. Это подсказка агенту, а не готовый текст.</p>
            <div v-for="topic in RESUME_FAQ_TOPICS" :key="topic.key" class="space-y-1.5">
              <Label>{{ topic.question }}</Label>
              <Input v-if="'short' in topic" v-model="faqAnswers[topic.key]" />
              <Textarea v-else v-model="faqAnswers[topic.key]" rows="2" />
              <p v-if="emptyHint(topic.key, faqAnswers[topic.key])" class="text-xs text-muted-foreground">
                Не заполнено, агент возьмёт из резюме: {{ emptyHint(topic.key, faqAnswers[topic.key]) }}
              </p>
            </div>
            <div v-for="entry in customFaq" :key="entry.id" class="space-y-1.5 rounded-md border p-3">
              <Input v-model="entry.question" placeholder="Вопрос" />
              <Textarea v-model="entry.answer" rows="2" placeholder="Как отвечать" />
              <Button variant="ghost" size="sm" @click="removeCustomFaq(entry.id)">Удалить</Button>
            </div>
            <Button variant="outline" size="sm" @click="addCustomFaq">Добавить свой вопрос</Button>
          </div>
          <div class="space-y-1.5">
            <Label>Общие заметки о резюме</Label>
            <Textarea v-model="comment" rows="4" />
          </div>
          <div class="flex gap-2">
            <Button :disabled="saveMutation.isLoading.value" @click="save">
              {{ saveMutation.isLoading.value ? "Сохраняю…" : "Сохранить" }}
            </Button>
          </div>
          <Alert v-if="saveMutation.error.value" variant="destructive">
            <CircleAlert />
            <AlertTitle>Не удалось сохранить</AlertTitle>
            <AlertDescription>{{ describeError(saveMutation.error.value) }}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <EmptyState v-else title="Резюме не найдено" description="Создайте резюме в hh.ru и импортируйте." />
    </div>
  </section>
</template>
