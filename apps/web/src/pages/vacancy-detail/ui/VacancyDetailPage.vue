<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert, ExternalLink } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationPath,
  companyPath,
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

const data = computed(() => vacancyQuery.data.value)
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
}
</script>

<template>
  <section>
    <PageHeader
      :title="data?.vacancy.title ?? 'Вакансия'"
      :description="subtitle"
      back-to="#/vacancies"
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
        <StatCard label="Опубликована" :value="formatDate(data.vacancy.publishedAt)" />
        <StatCard label="Замечена" :value="formatDate(data.vacancy.lastSeenAt)" />
      </div>

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
              <pre
                v-if="data.descriptionText.trim() !== ''"
                class="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
              >{{ data.descriptionText }}</pre>
              <EmptyState v-else title="Описание не разобрано" description="Запустите догрузку вакансии." />
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
              <Table v-if="data.keywords.length > 0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Термин</TableHead>
                    <TableHead>Форма</TableHead>
                    <TableHead>В заголовке</TableHead>
                    <TableHead>В тексте</TableHead>
                    <TableHead>В навыках</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="keyword in data.keywords" :key="keyword.keywordId">
                    <TableCell class="font-medium">{{ keyword.term }}</TableCell>
                    <TableCell>
                      {{ keyword.matchedForm }}
                      <span v-if="keyword.typo" class="text-xs text-muted-foreground"> · опечатка</span>
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
