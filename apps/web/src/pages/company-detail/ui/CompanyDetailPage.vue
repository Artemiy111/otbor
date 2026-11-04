<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert, ExternalLink } from "@lucide/vue"
import { applicationApi } from "@/entities/application"
import { AccountChip, useDefaultAccount } from "@/entities/hh-account"
import { companyApi, companyKeys } from "@/entities/company"
import { hydrationApi } from "@/entities/hydration"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  formatNumber,
  formatPercent,
  formatRating,
  formatSalary,
  seniorityLabel,
  vacancyPath
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const props = defineProps<{ id: string }>()

const query = useQuery({
  key: () => companyKeys.detail(props.id),
  query: () => companyApi.get(props.id)
})

/**
 * Opening a company re-hydrates it from hh.ru in the background: the cached
 * row renders at once and is replaced only if the fresh profile differs.
 * A failed or blocked refresh is not an error here, the stored data stays.
 */
const refreshing = ref(false)
watch(
  () => props.id,
  async (id) => {
    refreshing.value = true
    try {
      const { hydrated } = await hydrationApi.hydrateEmployer(id)
      if (hydrated && id === props.id) await query.refetch()
    } catch {
      // keep showing the stored profile
    } finally {
      if (id === props.id) refreshing.value = false
    }
  },
  { immediate: true }
)

const data = computed(() => query.data.value)
const employer = computed(() => data.value?.employer)
const vacancies = computed(() => data.value?.vacancies ?? [])

const { accounts } = useDefaultAccount()

/** Applications that count as "this account responded to the vacancy". */
const RESPONDED_STATES = new Set(["submitted", "submitting", "queued"])
const applicationsQuery = useQuery({
  key: () => ["applications", "by-vacancy"],
  query: () => applicationApi.list({ limit: 2000 })
})
const respondedAccounts = computed(() => {
  const byVacancy = new Map<string, string[]>()
  for (const application of applicationsQuery.data.value ?? []) {
    if (!RESPONDED_STATES.has(application.state)) continue
    const list = byVacancy.get(application.vacancyId) ?? []
    if (!list.includes(application.hhAccountId)) list.push(application.hhAccountId)
    byVacancy.set(application.vacancyId, list)
  }
  return byVacancy
})

const subtitle = computed(() => {
  const company = employer.value
  if (company === undefined) return undefined
  return [company.industries.slice(0, 3).join(", "), company.siteUrl]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ")
})

const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
</script>

<template>
  <section>
    <PageHeader
      :title="employer?.name ?? 'Компания'"
      :description="subtitle"
      back-to="/companies"
      back-label="Компании"
    >
      <template #actions>
        <Button v-if="employer?.siteUrl" as-child variant="outline" size="sm">
          <a :href="employer.siteUrl" target="_blank" rel="noreferrer">
            Сайт компании
            <ExternalLink class="h-4 w-4" />
          </a>
        </Button>
        <RefreshButton :loading="query.isLoading.value || refreshing" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить компанию</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="query.isPending.value" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="employer">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Рейтинг" :value="formatRating(employer.rating)" />
        <StatCard label="Отзывы" :value="formatNumber(employer.reviewsCount ?? 0)" />
        <StatCard label="Рекомендуют" :value="formatPercent(employer.recommendationsPercent)" />
        <StatCard label="Вакансий" :value="formatNumber(employer.vacancyCount)" />
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Профиль работодателя</CardTitle>
          <CardDescription>Данные, сохранённые вместе с вакансиями.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            v-if="employer.logoUrl"
            :src="employer.logoUrl"
            :alt="employer.name"
            class="size-20 shrink-0 rounded-lg border bg-white object-contain"
          />
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-lg font-semibold">{{ employer.name }}</span>
              <Badge variant="outline">
                <span class="mr-1 text-amber-400">★</span>
                {{ formatRating(employer.rating) }}
              </Badge>
              <Badge v-if="employer.recommendationsPercent !== null && employer.recommendationsPercent !== undefined" variant="success">
                {{ employer.recommendationsPercent }}% рекомендуют
              </Badge>
            </div>
            <div v-if="employer.industries.length > 0" class="flex flex-wrap gap-1.5">
              <Badge v-for="industry in employer.industries" :key="industry" variant="secondary" class="font-normal">
                {{ industry }}
              </Badge>
            </div>
            <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span v-if="employer.reviewsCount !== null && employer.reviewsCount !== undefined">
                {{ formatNumber(employer.reviewsCount) }} отзывов
              </span>
              <span v-if="employer.siteUrl">
                <a :href="employer.siteUrl" target="_blank" rel="noreferrer" class="hover:text-foreground">
                  {{ employer.siteUrl }}
                </a>
              </span>
              <span>external_id: <code class="font-mono">{{ employer.externalId }}</code></span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Вакансии компании</CardTitle>
          <CardDescription>Сохранённые в корпусе вакансии этого работодателя.</CardDescription>
        </CardHeader>
        <CardContent class="p-0">
          <Table v-if="vacancies.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead>Вакансия</TableHead>
                <TableHead>Зарплата</TableHead>
                <TableHead>Город</TableHead>
                <TableHead>Уровень</TableHead>
                <TableHead>Опубликована</TableHead>
                <TableHead>Аккаунты</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="vacancy in vacancies" :key="vacancy.id">
                <TableCell class="max-w-[420px]">
                  <a
                    :href="vacancyPath(vacancy.id)"
                    class="font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {{ vacancy.title }}
                  </a>
                  <div v-if="vacancy.archived" class="text-xs text-muted-foreground">архив</div>
                </TableCell>
                <TableCell class="whitespace-nowrap">
                  {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
                </TableCell>
                <TableCell>{{ vacancy.areaName ?? "—" }}</TableCell>
                <TableCell>{{ seniorityLabel(vacancy.seniority) }}</TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">
                  {{ formatDate(vacancy.publishedAt ?? vacancy.lastSeenAt) }}
                </TableCell>
                <TableCell>
                  <div v-if="respondedAccounts.has(vacancy.id)" class="flex flex-wrap gap-1">
                    <AccountChip
                      v-for="accountId in respondedAccounts.get(vacancy.id)"
                      :key="accountId"
                      :account-id="accountId"
                      :accounts="accounts"
                    />
                  </div>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState
            v-else
            title="Вакансий нет"
            description="У этой компании пока нет сохранённых вакансий."
          />
        </CardContent>
      </Card>
    </template>
  </section>
</template>
