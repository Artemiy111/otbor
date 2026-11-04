<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { HhAccountRecord, ResumeEnrichment, ResumeRecord } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { hhAccountApi, hhAccountKeys, useDefaultAccount } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  key: () => resumeKeys.list(selectedAccountId.value),
  query: () => resumeApi.list(selectedAccountId.value || undefined)
})
const resumes = computed<ReadonlyArray<ResumeRecord>>(() => resumesQuery.data.value ?? [])
const selectedResumeId = ref<string>("")
watch(resumes, (list) => {
  if (selectedResumeId.value === "" && list.length > 0) selectedResumeId.value = list[0]!.id
  if (list.length > 0 && !list.some((r) => r.id === selectedResumeId.value)) selectedResumeId.value = list[0]!.id
}, { immediate: true })

const selectedResume = computed(() => resumes.value.find((r) => r.id === selectedResumeId.value) ?? null)

const enrichmentQuery = useQuery({
  key: () => resumeKeys.enrichment(selectedResumeId.value),
  query: () => (selectedResumeId.value ? resumeApi.enrichmentGet(selectedResumeId.value) : Promise.resolve(null as any)),
  enabled: () => selectedResumeId.value !== ""
})

const comment = ref("")
const salaryMin = ref("")
const salaryExpectation = ref("")
const currency = ref("RUB")

watch(enrichmentQuery.data, (data: ResumeEnrichment | null) => {
  if (!data) return
  comment.value = data.comment ?? ""
  salaryMin.value = data.salaryMin === null || data.salaryMin === undefined ? "" : String(data.salaryMin)
  salaryExpectation.value = data.salaryExpectation === null || data.salaryExpectation === undefined ? "" : String(data.salaryExpectation)
  currency.value = data.currency ?? "RUB"
}, { immediate: true })

const queryCache = useQueryCache()
const saveMutation = useMutation({
  mutation: () =>
    resumeApi.enrichmentSave(selectedResumeId.value, {
      comment: comment.value,
      salaryMin: salaryMin.value === "" ? null : Number(salaryMin.value),
      salaryExpectation: salaryExpectation.value === "" ? null : Number(salaryExpectation.value),
      currency: currency.value
    }),
  onSuccess() {
    void queryCache.invalidateQueries({ key: resumeKeys.enrichment(selectedResumeId.value) })
  }
})

const save = () => saveMutation.mutate()

const aiSalary = computed(() => {
  const r = selectedResume.value
  const cur = currency.value || r?.salaryCurrency || ""
  const parts: string[] = []
  if (salaryExpectation.value) parts.push(`ожидает ${salaryExpectation.value} ${cur}`)
  else if (r?.salaryAmount) parts.push(`в резюме ${r.salaryAmount} ${r.salaryCurrency ?? ""}`)
  if (salaryMin.value) parts.push(`минимум ${salaryMin.value} ${cur}`)
  return parts.length ? parts.join(", ") : "не указана"
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
    const extra = (enrichmentQuery.data.value?.experience ?? []).find(
      (x: { key: string }) => x.key !== "" && key.includes(x.key.toLowerCase())
    )
    const comment = [extra?.employmentType, extra?.comment, extra?.leaveReason ? `причина ухода: ${extra.leaveReason}` : ""]
      .filter(Boolean)
      .join(" · ")
    return {
      title: [position, company].filter(Boolean).join(" — ") || "Место работы",
      period: start || end ? `${start || "?"} — ${end || "по настоящее время"}` : "",
      description: str(e.description),
      comment
    }
  })
)

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

    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Аккаунт</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <Select v-model="selectedAccountId">
            <SelectTrigger>
              <SelectValue placeholder="Выберите аккаунт" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                {{ account.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div class="space-y-1">
            <Label>Резюме</Label>
            <Select v-model="selectedResumeId">
              <SelectTrigger>
                <SelectValue placeholder="Выберите резюме" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="resume in resumes" :key="resume.id" :value="resume.id">
                  {{ resume.title }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

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
              <dt class="text-muted-foreground">Желаемая зарплата</dt>
              <dd>{{ aiSalary }}</dd>
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
              <li v-for="(item, index) in experienceItems" :key="index" class="rounded-md border p-3 text-sm">
                <div class="font-medium">{{ item.title }}</div>
                <div v-if="item.period" class="text-muted-foreground">{{ item.period }}</div>
                <p v-if="item.description" class="mt-1 whitespace-pre-wrap">{{ item.description }}</p>
                <p v-if="item.comment" class="mt-1 text-muted-foreground">Заметка: {{ item.comment }}</p>
              </li>
            </ul>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>Минимальная зарплата</Label>
              <Input v-model="salaryMin" type="number" />
            </div>
            <div class="space-y-1.5">
              <Label>Ожидаемая зарплата</Label>
              <Input v-model="salaryExpectation" type="number" />
            </div>
            <div class="space-y-1.5">
              <Label>Валюта</Label>
              <Input v-model="currency" />
            </div>
          </div>
          <div class="space-y-1.5">
            <Label>Заметки</Label>
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
