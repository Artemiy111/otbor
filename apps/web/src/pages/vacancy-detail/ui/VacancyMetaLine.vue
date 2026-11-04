<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import {
  companyPath,
  employmentFormLabel,
  experienceLabel,
  formatDate,
  formatRating,
  formatSalary,
  seniorityLabel,
  titleVerdictLabel,
  workFormatText
} from "@/shared/lib"
import { Badge, StatusBadge } from "@/shared/ui"

const props = defineProps<{ data: VacancyDetail }>()

const vacancy = computed(() => props.data.vacancy)
const validUntil = computed(() => props.data.facts?.hh?.validUntil ?? null)
const salary = computed(() =>
  formatSalary(vacancy.value.salaryFrom, vacancy.value.salaryTo, vacancy.value.salaryCurrency)
)
const seniority = computed(() =>
  vacancy.value.seniority === "unknown" ? null : seniorityLabel(vacancy.value.seniority)
)
const parts = computed(() =>
  [
    vacancy.value.areaName,
    seniority.value,
    experienceLabel(vacancy.value.experienceCode),
    employmentFormLabel(vacancy.value.employmentForm),
    vacancy.value.workFormats.length > 0
      ? vacancy.value.workFormats.map(workFormatText).join(", ")
      : null,
    vacancy.value.publishedAt ? `опубликована ${formatDate(vacancy.value.publishedAt)}` : null,
    validUntil.value ? `актуальна до ${formatDate(validUntil.value)}` : null
  ].filter((part): part is string => typeof part === "string" && part !== "")
)
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
      <Badge v-if="vacancy.archived" variant="neutral">в архиве</Badge>
      <Badge v-if="vacancy.blacklisted" variant="destructive">в чёрном списке</Badge>
      <StatusBadge
        v-if="data.titleVerdict"
        :value="data.titleVerdict"
        :label="titleVerdictLabel(data.titleVerdict)"
      />
    </div>
    <p v-if="salary !== '—'" class="text-lg font-semibold">{{ salary }}</p>
  </div>
</template>
