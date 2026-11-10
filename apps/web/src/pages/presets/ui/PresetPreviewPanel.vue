<script setup lang="ts">
import { computed } from "vue"
import type { PresetPreview, VacancySummary } from "@otbor/contract"
import { Building2, CircleAlert, ExternalLink, Tag, Wrench } from "@lucide/vue"
import {
  companyPath,
  formatDate,
  formatNumber,
  formatSalary,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton
} from "@/shared/ui"

const props = withDefaults(
  defineProps<{
    preview: PresetPreview | null
    loading?: boolean
    error?: string | null
    hint?: string
    vacanciesLimit?: number
  }>(),
  {
    loading: false,
    error: null,
    hint: "Что выберет текущий фильтр",
    vacanciesLimit: 5
  }
)

const vacancies = computed<ReadonlyArray<VacancySummary>>(() =>
  (props.preview?.vacancies ?? []).slice(0, props.vacanciesLimit)
)

const hasSalary = (vacancy: VacancySummary): boolean =>
  (vacancy.salaryFrom ?? null) !== null || (vacancy.salaryTo ?? null) !== null

const vacancyMeta = (vacancy: VacancySummary): string => {
  const parts = [
    vacancy.employerName ?? "—",
    vacancy.areaName ?? null,
    hasSalary(vacancy)
      ? formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency)
      : null,
    vacancy.publishedAt ? formatDate(vacancy.publishedAt) : null
  ]
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ")
}
</script>

<template>
  <Card>
    <CardHeader class="gap-2 pb-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="text-base">Предпросмотр</CardTitle>
          <CardDescription>{{ props.hint }}</CardDescription>
        </div>
        <div v-if="props.preview" class="shrink-0 text-right">
          <div class="text-xl font-semibold leading-none tabular-nums">
            {{ formatNumber(props.preview.count) }}
          </div>
          <div class="text-xs text-muted-foreground">вакансий</div>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4 border-t border-border pt-4">
      <div v-if="props.loading && props.preview === null" class="space-y-2">
        <Skeleton class="h-5 w-32" />
        <Skeleton class="h-24 w-full" />
      </div>

      <Alert v-else-if="props.error" variant="destructive">
        <CircleAlert />
        <AlertTitle>Предпросмотр не удался</AlertTitle>
        <AlertDescription>{{ props.error }}</AlertDescription>
      </Alert>

      <template v-else-if="props.preview">
        <p v-if="props.preview.count === 0" class="text-sm text-muted-foreground">
          Под эти правила пока не подходит ни одна вакансия.
        </p>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="min-w-0 space-y-1.5">
            <h4
              class="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground"
            >
              <Tag class="h-3 w-3" />
              Ключевые слова
            </h4>
            <div
              v-for="facet in props.preview.keywords"
              :key="facet.term"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="min-w-0 truncate" :title="facet.term">{{ facet.term }}</span>
              <span class="shrink-0 tabular-nums text-muted-foreground">{{ facet.count }}</span>
            </div>
            <p v-if="props.preview.keywords.length === 0" class="text-xs text-muted-foreground">
              —
            </p>
          </div>

          <div class="min-w-0 space-y-1.5">
            <h4
              class="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground"
            >
              <Wrench class="h-3 w-3" />
              Навыки hh
            </h4>
            <div
              v-for="facet in props.preview.skills"
              :key="facet.term"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="min-w-0 truncate" :title="facet.term">{{ facet.term }}</span>
              <span class="shrink-0 tabular-nums text-muted-foreground">{{ facet.count }}</span>
            </div>
            <p v-if="props.preview.skills.length === 0" class="text-xs text-muted-foreground">
              —
            </p>
          </div>

          <div class="min-w-0 space-y-1.5">
            <h4
              class="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground"
            >
              <Building2 class="h-3 w-3" />
              Компании
            </h4>
            <div
              v-for="company in props.preview.companies"
              :key="company.id"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <a
                :href="companyPath(company.id)"
                class="min-w-0 truncate transition-colors hover:text-primary"
                :title="company.name"
              >
                {{ company.name }}
              </a>
              <span class="shrink-0 tabular-nums text-muted-foreground">{{ company.count }}</span>
            </div>
            <p v-if="props.preview.companies.length === 0" class="text-xs text-muted-foreground">
              —
            </p>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Последние вакансии
            </h4>
            <span class="text-xs text-muted-foreground">
              {{ vacancies.length }} из {{ props.preview.vacancies.length }}
            </span>
          </div>

          <div
            v-for="vacancy in vacancies"
            :key="vacancy.id"
            class="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/40"
          >
            <a :href="vacancyPath(vacancy.id)" class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-sm font-medium">{{ vacancy.title }}</span>
                <Badge v-if="vacancy.archived" variant="neutral" class="shrink-0 text-xs">
                  архив
                </Badge>
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {{ vacancyMeta(vacancy) }}
              </div>
            </a>
            <a
              :href="vacancy.canonicalUrl"
              target="_blank"
              rel="noreferrer"
              class="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Открыть на hh.ru"
            >
              <ExternalLink class="h-3.5 w-3.5" />
            </a>
          </div>

          <p v-if="vacancies.length === 0" class="text-xs text-muted-foreground">
            В срезе пока нет вакансий.
          </p>
        </div>
      </template>
    </CardContent>
  </Card>
</template>
