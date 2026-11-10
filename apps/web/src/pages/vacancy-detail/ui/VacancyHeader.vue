<script setup lang="ts">
import { computed } from "vue"
import { Ellipsis, ExternalLink, RefreshCw } from "@lucide/vue"
import { RejectVacancyButton } from "@/features/vacancy-reject"
import { companyPath, formatDate, formatRating, formatSalary, vacanciesReturnPath } from "@/shared/lib"
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/shared/ui"
import { keyFactsLine } from "../lib"
import type { VacancyPage } from "../model"
import VacancyHydrateStatus from "./VacancyHydrateStatus.vue"

const props = defineProps<{ page: VacancyPage }>()

const detail = computed(() => props.page.data.value)
const vacancy = computed(() => detail.value?.vacancy ?? null)
const salary = computed(() => {
  const value = vacancy.value
  if (value === null) return null
  const text = formatSalary(value.salaryFrom, value.salaryTo, value.salaryCurrency)
  return text === "—" ? null : text
})
const facts = computed(() => (vacancy.value === null ? "" : keyFactsLine(vacancy.value)))
const backTo = vacanciesReturnPath()
</script>

<template>
  <header class="space-y-3">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink :href="backTo">Вакансии</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage class="max-w-[60vw] truncate sm:max-w-xl">{{ vacancy?.title ?? "Вакансия" }}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-2">
        <h1 class="text-2xl font-semibold tracking-tight text-balance">{{ vacancy?.title ?? "Вакансия" }}</h1>

        <div v-if="vacancy" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <template v-if="vacancy.employerId">
            <a
              :href="companyPath(vacancy.employerId)"
              class="rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >{{ vacancy.employerName ?? "Без названия" }}</a>
            <span v-if="vacancy.employerRating" class="tabular-nums text-warning">★ {{ formatRating(vacancy.employerRating) }}</span>
          </template>
          <span v-else class="font-medium">{{ vacancy.employerName ?? "Компания не указана" }}</span>
          <Badge v-if="vacancy.blacklisted" variant="danger">в чёрном списке</Badge>
        </div>

        <p v-if="vacancy" class="text-xl font-semibold tabular-nums" :class="salary ? '' : 'text-base font-normal text-muted-foreground'">
          {{ salary ?? "Зарплата не указана" }}
        </p>
        <p v-if="facts" class="text-sm text-muted-foreground">{{ facts }}</p>
        <p v-if="vacancy" class="text-xs tabular-nums text-muted-foreground">
          <template v-if="vacancy.publishedAt">Опубликована {{ formatDate(vacancy.publishedAt) }} · </template>найдена {{ formatDate(vacancy.createdAt) }}
        </p>
        <VacancyHydrateStatus :page="page" />
      </div>

      <div v-if="vacancy" class="flex shrink-0 flex-wrap items-center gap-2">
        <Button as-child variant="outline" size="sm">
          <a :href="vacancy.canonicalUrl" target="_blank" rel="noreferrer">
            Открыть на hh
            <ExternalLink class="size-4" />
          </a>
        </Button>
        <RejectVacancyButton
          :vacancy-id="page.id()"
          :accounts="page.accounts.value"
          :resumes="page.resumes.value"
          :account-id="page.accountId.value"
          :resume-id="page.resumeId.value"
        />
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm" class="w-8 px-0" aria-label="Ещё действия">
              <Ellipsis class="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-1" align="end">
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              :disabled="page.hydrating.value"
              @click="page.hydrate"
            >
              <RefreshCw class="size-4" :class="page.hydrating.value ? 'animate-spin' : ''" />
              Заново загрузить с hh
            </Button>
            <p class="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
              Скачает страницу вакансии и обновит отклики аккаунта.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div
      v-if="vacancy?.archived"
      class="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
      role="status"
    >
      Вакансия в архиве на hh — откликнуться нельзя.
    </div>
  </header>
</template>
