<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import {
  companyPath,
  employmentFormLabel,
  formatDate,
  formatRating,
  formatSalary,
  titleVerdictLabel,
  type ReconRow
} from "@/shared/lib"
import { Badge, StatusBadge } from "@/shared/ui"
import ReconDots from "./ReconDots.vue"

const props = defineProps<{ data: VacancyDetail; recon: ReadonlyMap<string, ReconRow> }>()

const vacancy = computed(() => props.data.vacancy)
const validUntil = computed(() => props.data.facts?.hh?.validUntil ?? null)
const salary = computed(() =>
  formatSalary(vacancy.value.salaryFrom, vacancy.value.salaryTo, vacancy.value.salaryCurrency)
)

interface Part {
  readonly key: string
  readonly text: string
  readonly row?: ReconRow
}

/** A value shared by several sources reads once; a disagreement reads "hh ≠ ИИ". */
const reconText = (row: ReconRow): string => {
  const seen = new Map<string, string>()
  for (const cell of Object.values(row.cells)) {
    if (cell.norm !== null && cell.norm !== "нет" && !seen.has(cell.norm)) seen.set(cell.norm, cell.text ?? cell.norm)
  }
  return [...seen.values()].join(" ≠ ")
}

const parts = computed<ReadonlyArray<Part>>(() => {
  const out: Array<Part> = []
  const push = (key: string, text: string | null | undefined, row?: ReconRow) => {
    if (text !== null && text !== undefined && text !== "") out.push({ key, text, ...(row ? { row } : {}) })
  }
  const row = (key: string) => props.recon.get(key)
  push("area", vacancy.value.areaName)
  const level = row("level")
  if (level) push("level", reconText(level), level)
  const experience = row("experience")
  if (experience) push("experience", `опыт ${reconText(experience)}`, experience)
  push("employment", employmentFormLabel(vacancy.value.employmentForm))
  const format = row("format")
  if (format) push("format", reconText(format), format)
  push("published", vacancy.value.publishedAt ? `опубликована ${formatDate(vacancy.value.publishedAt)}` : null)
  push("valid", validUntil.value ? `актуальна до ${formatDate(validUntil.value)}` : null)
  return out
})
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
      <template v-for="part in parts" :key="part.key">
        <span aria-hidden="true">·</span>
        <span class="inline-flex items-center gap-1" :class="part.row?.conflict ? 'text-amber-300' : ''">
          {{ part.text }}
          <ReconDots v-if="part.row" :row="part.row" />
        </span>
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
