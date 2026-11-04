<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { companyPath, formatDate, formatRating, formatSalary, seniorityLabel } from "@/shared/lib"
import { Badge, StatusBadge } from "@/shared/ui"

const props = defineProps<{ data: VacancyDetail }>()

const vacancy = computed(() => props.data.vacancy)
const validUntil = computed(() => props.data.facts?.hh?.validUntil ?? null)
const salary = computed(() =>
  formatSalary(vacancy.value.salaryFrom, vacancy.value.salaryTo, vacancy.value.salaryCurrency)
)
const parts = computed(() =>
  [
    vacancy.value.areaName,
    seniorityLabel(vacancy.value.seniority),
    vacancy.value.experienceCode,
    vacancy.value.employmentForm,
    vacancy.value.workFormats.length > 0 ? vacancy.value.workFormats.join(", ") : null,
    salary.value !== "—" ? salary.value : null,
    vacancy.value.publishedAt ? `опубликована ${formatDate(vacancy.value.publishedAt)}` : null,
    validUntil.value ? `актуальна до ${formatDate(validUntil.value)}` : null
  ].filter((part): part is string => typeof part === "string" && part !== "" && part !== "—")
)
</script>

<template>
  <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
    <template v-if="vacancy.employerId">
      <a
        :href="companyPath(vacancy.employerId)"
        class="font-medium text-foreground transition-colors hover:text-primary"
      >
        {{ vacancy.employerName ?? "Без названия" }}
      </a>
      <span v-if="vacancy.employerRating" class="text-amber-300">
        ★ {{ formatRating(vacancy.employerRating) }}
      </span>
    </template>
    <span v-else>{{ vacancy.employerName ?? "Компания не указана" }}</span>
    <template v-for="part in parts" :key="part">
      <span aria-hidden="true">·</span>
      <span>{{ part }}</span>
    </template>
    <Badge v-if="vacancy.archived" variant="neutral">архив</Badge>
    <StatusBadge v-if="data.titleVerdict" :value="data.titleVerdict" raw />
  </div>
</template>
