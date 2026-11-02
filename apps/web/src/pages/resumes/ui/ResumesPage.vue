<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { HhAccountRecord, ResumeEnrichment, ResumeRecord } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
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
const selectedAccountId = ref<string>("")
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

const refresh = () => {
  void resumesQuery.refetch()
  void enrichmentQuery.refetch()
}
</script>

<template>
  <section>
    <PageHeader title="Резюме" description="Резюме hh.ru и локальные дополнения для сопроводительных писем.">
      <template #actions>
        <RefreshButton :loading="resumesQuery.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

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
          <CardDescription>{{ selectedResume.text }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
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
