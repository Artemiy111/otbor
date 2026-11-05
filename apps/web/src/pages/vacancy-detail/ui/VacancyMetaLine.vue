<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { companyPath, formatDate, formatRating, titleVerdictLabel } from "@/shared/lib"
import { Badge, StatusBadge } from "@/shared/ui"

const props = defineProps<{ data: VacancyDetail }>()

const vacancy = computed(() => props.data.vacancy)
const validUntil = computed(() => props.data.facts?.hh?.validUntil ?? null)
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
    <template v-if="vacancy.employerId">
      <a
        :href="companyPath(vacancy.employerId)"
        class="font-medium text-foreground transition-colors hover:text-primary"
      >
        {{ vacancy.employerName ?? "Без названия" }}
      </a>
      <span v-if="vacancy.employerRating" class="text-amber-700 dark:text-amber-300">★ {{ formatRating(vacancy.employerRating) }}</span>
    </template>
    <span v-else class="font-medium text-foreground">{{ vacancy.employerName ?? "Компания не указана" }}</span>
    <template v-if="vacancy.areaName">
      <span aria-hidden="true">·</span>
      <span>{{ vacancy.areaName }}</span>
    </template>
    <template v-if="vacancy.publishedAt">
      <span aria-hidden="true">·</span>
      <span>{{ formatDate(vacancy.publishedAt) }}</span>
    </template>
    <template v-if="validUntil">
      <span aria-hidden="true">·</span>
      <span>актуальна до {{ formatDate(validUntil) }}</span>
    </template>
    <Badge v-if="vacancy.archived" variant="neutral">в архиве</Badge>
    <Badge v-if="vacancy.blacklisted" variant="destructive">в чёрном списке</Badge>
    <StatusBadge
      v-if="data.titleVerdict"
      :value="data.titleVerdict"
      :label="titleVerdictLabel(data.titleVerdict)"
    />
  </div>
</template>
