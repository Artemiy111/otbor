<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert, ExternalLink } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { contactApi, contactKeys } from "@/entities/contact"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationPath,
  companyPath,
  contactHref,
  contactKindLabel,
  contactSourceLabel,
  decisionsPath,
  describeError,
  formatDate,
  formatNumber,
  formatRating,
  formatSalary,
  seniorityLabel,
  statusLabel
} from "@/shared/lib"
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
  EmptyState,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const props = defineProps<{ id: string }>()

const vacancyQuery = useQuery({
  key: () => vacancyKeys.detail(props.id),
  query: () => vacancyApi.get(props.id)
})

const decisionsQuery = useQuery({
  key: decisionKeys.list("all"),
  query: () => decisionApi.list({ limit: 200 })
})

const applicationsQuery = useQuery({
  key: applicationKeys.list("all"),
  query: () => applicationApi.list({ limit: 200 })
})

const contactsQuery = useQuery({
  key: () => contactKeys.vacancy(props.id),
  query: () => contactApi.list({ vacancyId: props.id, limit: 50 })
})

const data = computed(() => vacancyQuery.data.value)
const contacts = computed(() => contactsQuery.data.value?.items ?? [])

const highlightKeywords = ref(true)

const keywordTotals = computed(() => {
  const totals = new Map<string, number>()
  for (const keyword of data.value?.keywords ?? []) {
    const count = keyword.titleCount + keyword.bodyCount
    totals.set(keyword.term, (totals.get(keyword.term) ?? 0) + count)
  }
  return totals
})

const groupedKeywords = computed(() => {
  const groups = new Map<
    string,
    { term: string; forms: Array<NonNullable<typeof data.value>["keywords"][number]>; total: number }
  >()
  for (const keyword of data.value?.keywords ?? []) {
    const group = groups.get(keyword.term) ?? { term: keyword.term, forms: [], total: 0 }
    group.forms.push(keyword)
    group.total += keyword.titleCount + keyword.bodyCount
    groups.set(keyword.term, group)
  }
  return [...groups.values()]
    .map((group) => ({
      term: group.term,
      total: group.total,
      titleCount: group.forms.reduce((sum, form) => sum + form.titleCount, 0),
      bodyCount: group.forms.reduce((sum, form) => sum + form.bodyCount, 0),
      inSkills: group.forms.some((form) => form.inSkills),
      forms: group.forms
        .map((form) => ({
          ...form,
          share:
            group.total > 0
              ? Math.round(((form.titleCount + form.bodyCount) / group.total) * 100)
              : 0
        }))
        .sort((a, b) => b.titleCount + b.bodyCount - (a.titleCount + a.bodyCount))
    }))
    .sort((a, b) => a.term.localeCompare(b.term, "ru"))
})

const highlightedDescription = computed(() => {
  const text = data.value?.descriptionText ?? ""
  if (text.trim() === "" || !highlightKeywords.value) return null
  const forms = [...new Set((data.value?.keywords ?? []).map((item) => item.matchedForm).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  if (forms.length === 0) return null
  const escaped = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const pattern = new RegExp(`(${forms.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu")
  return escaped(text).replace(pattern, (match) => `<mark class="rounded bg-amber-200/60 px-0.5 text-foreground dark:bg-amber-400/30">${match}</mark>`)
})
const decisions = computed(() =>
  (decisionsQuery.data.value ?? []).filter((decision) => decision.vacancyId === props.id)
)
const applications = computed(() =>
  (applicationsQuery.data.value ?? []).filter((application) => application.vacancyId === props.id)
)

const subtitle = computed(() => {
  const vacancy = data.value?.vacancy
  if (vacancy === undefined) return undefined
  return [
    vacancy.employerName ?? "Компания не указана",
    vacancy.areaName,
    seniorityLabel(vacancy.seniority),
    vacancy.archived ? "архив" : null
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ")
})

const isLoading = computed(() => vacancyQuery.isLoading.value)
const errorText = computed(() =>
  vacancyQuery.error.value === null ? null : describeError(vacancyQuery.error.value)
)

const refresh = () => {
  void vacancyQuery.refetch()
  void decisionsQuery.refetch()
  void applicationsQuery.refetch()
  void contactsQuery.refetch()
}

const hydrating = ref(false)
const autoHydrate = async () => {
  const detail = vacancyQuery.data.value
  if (detail === undefined || hydrating.value) return
  if (detail.descriptionText.trim() !== "") return
  hydrating.value = true
  try {
    const result = await vacancyApi.hydrate(props.id)
    if (result.hydrated) {
      await vacancyQuery.refetch()
      void contactsQuery.refetch()
    }
  } catch {
    // Hydration is best-effort; the stub stays visible if it fails.
  } finally {
    hydrating.value = false
  }
}
watch(
  () => vacancyQuery.data.value,
  (detail) => {
    if (detail !== undefined && detail.descriptionText.trim() === "") {
      void autoHydrate()
    }
  },
  { immediate: true }
)
</script>

<template>
  <section>
    <PageHeader
      :title="data?.vacancy.title ?? 'Вакансия'"
      :description="subtitle"
      back-to="/vacancies"
      back-label="Вакансии"
    >
      <template #actions>
        <StatusBadge v-if="data?.titleVerdict" :value="data.titleVerdict" raw />
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="data.vacancy.canonicalUrl" target="_blank" rel="noreferrer">
            Открыть на hh
            <ExternalLink class="h-4 w-4" />
          </a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансию</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="vacancyQuery.isPending.value" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>
      <Skeleton class="h-11 w-72" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Зарплата"
          :value="
            formatSalary(data.vacancy.salaryFrom, data.vacancy.salaryTo, data.vacancy.salaryCurrency)
          "
        />
        <StatCard label="Уровень" :value="seniorityLabel(data.vacancy.seniority)" />
        <StatCard label="Занятость" :value="data.vacancy.employmentForm ?? '—'" />
        <StatCard label="Опыт" :value="data.vacancy.experienceCode ?? '—'" />
        <StatCard label="Опубликована" :value="formatDate(data.vacancy.publishedAt)" />
        <StatCard label="Замечена" :value="formatDate(data.vacancy.lastSeenAt)" />
      </div>

      <Card v-if="data.vacancy.workFormats.length > 0" class="mt-4">
        <CardHeader>
          <CardTitle>Формат работы</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-wrap gap-2">
          <Badge v-for="format in data.vacancy.workFormats" :key="format" variant="secondary">
            {{ format }}
          </Badge>
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Компания</CardTitle>
          <CardDescription>Профиль работодателя и рейтинг на hh.ru.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-wrap items-center gap-3">
          <template v-if="data.vacancy.employerId">
            <a
              :href="companyPath(data.vacancy.employerId)"
              class="text-base font-medium text-foreground transition-colors hover:text-primary"
            >
              {{ data.vacancy.employerName ?? "Без названия" }}
            </a>
            <Badge variant="outline">
              рейтинг {{ formatRating(data.vacancy.employerRating) }}
            </Badge>
            <Button as-child variant="outline" size="sm">
              <a :href="companyPath(data.vacancy.employerId)">Все вакансии компании</a>
            </Button>
          </template>
          <span v-else class="text-sm text-muted-foreground">
            {{ data.vacancy.employerName ?? "Компания не указана" }}
          </span>
        </CardContent>
      </Card>

      <Tabs default-value="description" class="mt-4">
        <TabsList>
          <TabsTrigger value="description">Описание</TabsTrigger>
          <TabsTrigger value="contacts">Контакты ({{ contacts.length }})</TabsTrigger>
          <TabsTrigger value="skills">Навыки ({{ data.skills.length }})</TabsTrigger>
          <TabsTrigger value="keywords">Ключевые слова ({{ data.keywords.length }})</TabsTrigger>
          <TabsTrigger value="links">
            Связи ({{ decisions.length }} / {{ applications.length }})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="description">
          <Card>
            <CardHeader>
              <CardTitle>Текст вакансии</CardTitle>
              <CardDescription>
                Как он сохранён в корпусе после разбора страницы hh.ru.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div class="mb-2 flex items-center gap-2">
               <label class="flex items-center gap-2 text-xs text-muted-foreground">
                 <input v-model="highlightKeywords" type="checkbox" class="size-4 rounded border-input accent-primary" />
                 Подсветить ключевые слова
               </label>
             </div>
             <div
               v-if="highlightedDescription !== null"
               class="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
               v-html="highlightedDescription"
             />
             <pre
               v-else-if="data.descriptionText.trim() !== ''"
               class="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
             >{{ data.descriptionText }}</pre>
              <EmptyState v-else title="Описание не разобрано" description="Запустите догрузку вакансии." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader>
              <CardTitle>Контакты</CardTitle>
              <CardDescription>
                Способы связи, найденные в тексте вакансии. Общий список — в разделе «Контакты».
              </CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <Table v-if="contacts.length > 0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Источник</TableHead>
                    <TableHead>Доказательство</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="contact in contacts" :key="contact.id">
                    <TableCell>
                      <a
                        v-if="contactHref(contact)"
                        :href="contactHref(contact) ?? undefined"
                        :target="/^https?:/i.test(contactHref(contact) ?? '') ? '_blank' : undefined"
                        :rel="/^https?:/i.test(contactHref(contact) ?? '') ? 'noreferrer' : undefined"
                        class="break-all font-medium text-sky-300 underline-offset-4 hover:underline"
                      >
                        {{ contact.value }}
                      </a>
                      <span v-else class="break-all font-medium">{{ contact.value }}</span>
                      <div class="text-xs text-muted-foreground">
                        {{ contactKindLabel(contact.kind) }}
                        <template v-if="contact.personName">
                          · {{ contact.personName }}
                        </template>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{{ contactSourceLabel(contact.source) }}</Badge>
                    </TableCell>
                    <TableCell class="max-w-[420px]">
                      <span class="block truncate text-xs text-muted-foreground" :title="contact.evidence ?? undefined">
                        {{ contact.evidence ?? "—" }}
                      </span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <EmptyState
                v-else
                title="Контактов нет"
                description="В тексте вакансии контактов нет."
              />
              <div class="border-t border-border p-3">
                <Button as-child variant="outline" size="sm">
                  <a href="/contacts">Все контакты</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardHeader>
              <CardTitle>Навыки</CardTitle>
              <CardDescription>Теги, которые работодатель указал в вакансии.</CardDescription>
            </CardHeader>
            <CardContent>
              <div v-if="data.skills.length > 0" class="flex flex-wrap gap-1.5">
                <Badge v-for="skill in data.skills" :key="skill" variant="secondary">
                  {{ skill }}
                </Badge>
              </div>
              <EmptyState v-else title="Навыки не найдены" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keywords">
          <Card>
            <CardHeader>
              <CardTitle>Совпадения словаря</CardTitle>
              <CardDescription>
                Вхождения ключевых слов в заголовок, текст и навыки.
              </CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <Table v-if="groupedKeywords.length > 0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Термин</TableHead>
                    <TableHead>Формы</TableHead>
                    <TableHead>В заголовке</TableHead>
                    <TableHead>В тексте</TableHead>
                    <TableHead>В навыках</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="keyword in groupedKeywords" :key="keyword.term">
                    <TableCell class="font-medium">{{ keyword.term }}</TableCell>
                    <TableCell>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="form in keyword.forms"
                          :key="form.matchedForm"
                          class="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs"
                        >
                          {{ form.matchedForm }}
                          <span v-if="form.typo" class="text-muted-foreground">· опечатка</span>
                          <span class="text-muted-foreground">{{ form.share }}%</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{{ formatNumber(keyword.titleCount) }}</TableCell>
                    <TableCell>{{ formatNumber(keyword.bodyCount) }}</TableCell>
                    <TableCell>{{ keyword.inSkills ? "да" : "—" }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <EmptyState v-else title="Совпадений нет" description="Словарь не нашёл терминов в этой вакансии." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links">
          <div class="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Решения</CardTitle>
                <CardDescription>Сохранённые вердикты по этой вакансии.</CardDescription>
              </CardHeader>
              <CardContent class="p-0">
                <Table v-if="decisions.length > 0">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Вердикт</TableHead>
                      <TableHead>Соответствие</TableHead>
                      <TableHead>Создано</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="decision in decisions" :key="decision.id">
                      <TableCell><StatusBadge :value="decision.verdict" /></TableCell>
                      <TableCell>{{ decision.fit }}</TableCell>
                      <TableCell class="text-muted-foreground">
                        {{ formatDate(decision.createdAt) }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <EmptyState v-else title="Решений нет" description="Вакансия ещё не оценивалась." />
                <div class="border-t border-border p-3">
                  <Button as-child variant="outline" size="sm">
                    <a :href="decisionsPath()">Все решения</a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Отклики</CardTitle>
                <CardDescription>Рабочие процессы по этой вакансии.</CardDescription>
              </CardHeader>
              <CardContent class="p-0">
                <Table v-if="applications.length > 0">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Состояние</TableHead>
                      <TableHead>Обновлён</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="application in applications" :key="application.id">
                      <TableCell>
                        <a
                          :href="applicationPath(application.id)"
                          class="font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {{ statusLabel(application.state) }}
                        </a>
                      </TableCell>
                      <TableCell class="text-muted-foreground">
                        {{ formatDate(application.updatedAt) }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <EmptyState v-else title="Откликов нет" description="По вакансии ещё не создан отклик." />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </template>
  </section>
</template>
