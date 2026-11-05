<script setup lang="ts">
import { computed, ref } from "vue"
import { Eye, Users } from "@lucide/vue"
import type { RowProps } from "./model"
import { employerAvatar, rowClass } from "./model"
import RowBadges from "./RowBadges.vue"
import {
  cn,
  companyPath,
  employmentFormLabel,
  experienceLabel,
  formatAge,
  formatDate,
  formatNumber,
  formatRating,
  formatSalary,
  seniorityLabel,
  vacancyPath,
  workFormatText,
  ANALYSIS_ROLE_LABELS
} from "@/shared/lib"

const props = defineProps<RowProps>()
const role = computed(() => (props.vacancy.analysisRole ? (ANALYSIS_ROLE_LABELS[props.vacancy.analysisRole] ?? props.vacancy.analysisRole) : null))
const logoFailed = ref(false)
const avatar = computed(() => employerAvatar(props.vacancy.employerName))
const facts = computed(() =>
  [
    props.vacancy.seniority === "unknown" ? null : seniorityLabel(props.vacancy.seniority),
    employmentFormLabel(props.vacancy.employmentForm),
    ...props.vacancy.workFormats.map(workFormatText)
  ].filter((value): value is string => value !== null)
)
const HH_YEARS: Record<string, number> = { noExperience: 0, between1And3: 1, between3And6: 3, moreThan6: 6 }
/** Required experience as on the vacancy page: hh's range, the AI's reading, amber when they disagree. */
const experience = computed(() => {
  const hh = props.vacancy.experienceCode ?? null
  const hhText = experienceLabel(hh)?.replace(/^опыт /, "") ?? null
  const ai = props.vacancy.analysisYearsMin ?? null
  const aiYears = ai === null ? null : Math.round(ai)
  const aiText = aiYears === null ? null : aiYears <= 0 ? "без опыта" : `от ${aiYears} ${aiYears === 1 ? "года" : "лет"}`
  if (hhText === null && aiText === null) return null
  const hhYears = hh === null ? null : (HH_YEARS[hh] ?? null)
  const conflict = hhYears !== null && aiYears !== null && hhYears !== aiYears
  const text = conflict ? `${hhText} ≠ ${aiText}` : (hhText ?? aiText)
  return { text: `опыт ${text}`, conflict, title: `hh: ${hhText ?? "—"}\nИИ: ${aiText ?? "—"}` }
})
const hasSalary = computed(() => props.vacancy.salaryFrom != null || props.vacancy.salaryTo != null)
const seenAgo = computed(() => formatAge(Math.max(0, (Date.now() - Date.parse(props.vacancy.lastSeenAt)) / 1000)))
</script>

<template>
  <article :class="cn('flex gap-4 px-3 py-5', rowClass(vacancy))">
    <div :class="cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold', avatar.tone)" aria-hidden="true">
      <img
        v-if="vacancy.employerLogoUrl && !logoFailed"
        :src="vacancy.employerLogoUrl"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        class="h-full w-full rounded-lg bg-white object-contain"
        @error="logoFailed = true"
      />
      <template v-else>{{ avatar.letter }}</template>
    </div>
    <div class="min-w-0 flex-1 space-y-2">
      <div class="flex items-start justify-between gap-6">
        <div class="min-w-0">
          <a
            :href="vacancyPath(vacancy.id)"
            :class="cn('block text-base font-semibold leading-snug transition-colors hover:text-primary', vacancy.blacklisted && 'text-red-700 dark:text-red-300')"
          >
            {{ vacancy.title }}
          </a>
          <p class="mt-0.5 text-sm text-muted-foreground">
            <a v-if="vacancy.employerId" :href="companyPath(vacancy.employerId)" class="font-medium text-foreground hover:text-primary">{{ vacancy.employerName ?? "Без названия" }}</a>
            <span v-else class="font-medium text-foreground">{{ vacancy.employerName ?? "Компания не указана" }}</span>
            <span v-if="vacancy.employerRating" class="ml-1.5 text-amber-700 dark:text-amber-300">★ {{ formatRating(vacancy.employerRating) }}</span>
            <template v-if="vacancy.areaName"> · {{ vacancy.areaName }}</template>
          </p>
        </div>
        <p v-if="hasSalary" class="shrink-0 whitespace-nowrap text-right text-base font-semibold tabular-nums">
          {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
        </p>
      </div>

      <p v-if="vacancy.snippet" class="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{{ vacancy.snippet }}</p>

      <div v-if="facts.length || role || experience" class="flex flex-wrap gap-1.5">
        <span v-if="role" class="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300" title="Роль по ИИ-анализу">ИИ: {{ role }}</span>
        <span
          v-if="experience"
          :title="experience.title"
          :class="cn('rounded-md border px-2 py-0.5 text-xs', experience.conflict ? 'border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-100' : 'border-border text-foreground/80')"
        >{{ experience.text }}</span>
        <span v-for="fact in facts" :key="fact" class="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{{ fact }}</span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-0.5">
        <div class="flex flex-wrap items-center gap-1.5"><RowBadges v-bind="props" /></div>
        <div class="flex items-center gap-4 text-xs text-muted-foreground">
          <span v-if="vacancy.responsesTotal != null" class="inline-flex items-center gap-1" title="Откликов на hh">
            <Users class="h-3.5 w-3.5" />
            <b class="font-semibold text-foreground">{{ formatNumber(vacancy.responsesTotal) }}</b> откликов
          </span>
          <span class="inline-flex items-center gap-1" :title="`Последний раз видели ${formatDate(vacancy.lastSeenAt)}`">
            <Eye class="h-3.5 w-3.5" /> {{ seenAgo }} назад
          </span>
          <span>{{ formatDate(vacancy.publishedAt ?? vacancy.createdAt) }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
