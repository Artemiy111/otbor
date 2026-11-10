<script setup lang="ts">
import { computed, ref } from "vue"
import { useMediaQuery } from "@vueuse/core"
import { Eye, Users } from "@lucide/vue"
import type { RowProps } from "./model"
import { employerAvatar, rowClass } from "./model"
import { isNewVacancy } from "../../model/filters"
import RowActions from "./RowActions.vue"
import RowBadges from "./RowBadges.vue"
import RowDecision from "./RowDecision.vue"
import { Badge } from "@/shared/ui"
import {
  cn,
  companyPath,
  employmentFormLabel,
  experienceLabel,
  formatAge,
  employerLogoSrc,
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
const isNew = computed(() => isNewVacancy(props.vacancy.createdAt, props.since))

/** Действия показываются, когда строку навели или в ней фокус; на сенсорных экранах всегда. */
const engaged = ref(false)
const touch = useMediaQuery("(hover: none)")
const onFocusOut = (event: FocusEvent) => {
  const row = event.currentTarget as HTMLElement
  if (!row.contains(event.relatedTarget as Node | null)) engaged.value = false
}
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
const logoSrc = computed(() => employerLogoSrc(props.vacancy.employerId, props.vacancy.employerLogoUrl))
const logoShown = computed(() => logoSrc.value !== null && !logoFailed.value)
const hasSalary = computed(() => props.vacancy.salaryFrom != null || props.vacancy.salaryTo != null)
const seenAgo = computed(() => formatAge(Math.max(0, (Date.now() - Date.parse(props.vacancy.lastSeenAt)) / 1000)))
</script>

<template>
  <article
    :class="
      cn(
        'group relative grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 gap-y-3 px-3 py-4 transition-colors hover:bg-muted/40 focus-within:bg-muted/40 lg:grid-cols-[44px_minmax(0,1fr)_264px]',
        rowClass(vacancy)
      )
    "
    @pointerenter="engaged = true"
    @pointerleave="engaged = false"
    @focusin="engaged = true"
    @focusout="onFocusOut"
  >
    <div :class="cn('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg text-lg font-semibold', !logoShown && 'bg-[oklch(0.7_0.12_var(--avatar-h)/0.18)] text-[oklch(0.5_0.12_var(--avatar-h))] dark:text-[oklch(0.82_0.1_var(--avatar-h))]')" :style="{ '--avatar-h': String(avatar.hue) }" aria-hidden="true">
      <img
        v-if="logoShown"
        :src="logoSrc!"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        class="h-full w-full bg-white object-contain"
        @error="logoFailed = true"
      />
      <template v-else>{{ avatar.letter }}</template>
    </div>

    <div class="min-w-0 space-y-2">
      <div class="flex flex-col gap-x-6 gap-y-0.5 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <!-- Растянутая ссылка: вся строка ведёт на вакансию, остальные ссылки поднимаются над ней. -->
            <a
              :href="vacancyPath(vacancy.id)"
              :class="cn('text-base font-semibold leading-snug outline-none transition-colors after:absolute after:inset-0 hover:text-primary focus-visible:text-primary focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring', vacancy.blacklisted && 'text-danger')"
            >
              {{ vacancy.title }}
            </a>
            <Badge v-if="isNew" variant="info" title="Найдена с вашего прошлого визита">Новая</Badge>
          </div>
          <p class="mt-0.5 text-sm text-muted-foreground">
            <a v-if="vacancy.employerId" :href="companyPath(vacancy.employerId)" class="relative z-10 font-medium text-foreground hover:text-primary">{{ vacancy.employerName ?? "Без названия" }}</a>
            <span v-else class="font-medium text-foreground">{{ vacancy.employerName ?? "Компания не указана" }}</span>
            <span v-if="vacancy.employerRating" class="ml-1.5 text-warning tabular-nums">★ {{ formatRating(vacancy.employerRating) }}</span>
            <template v-if="vacancy.areaName"> · {{ vacancy.areaName }}</template>
          </p>
        </div>
        <p v-if="hasSalary" class="shrink-0 whitespace-nowrap text-base font-semibold tabular-nums sm:text-right">
          {{ formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency) }}
        </p>
      </div>

      <p v-if="vacancy.snippet" class="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{{ vacancy.snippet }}</p>

      <div v-if="facts.length || role || experience" class="flex flex-wrap gap-1.5">
        <span v-if="role" class="rounded-md bg-info-muted px-2 py-0.5 text-xs font-medium text-info" title="Роль по ИИ-анализу">ИИ: {{ role }}</span>
        <span
          v-if="experience"
          :title="experience.title"
          :class="cn('rounded-md border px-2 py-0.5 text-xs', experience.conflict ? 'border-warning/30 bg-warning-muted text-warning' : 'border-border text-foreground/80')"
        >{{ experience.text }}</span>
        <span v-for="fact in facts" :key="fact" class="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{{ fact }}</span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-0.5">
        <div class="flex flex-wrap items-center gap-1.5"><RowBadges v-bind="props" /></div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span v-if="vacancy.responsesTotal != null" class="inline-flex items-center gap-1" title="Откликов на hh">
            <Users class="size-3.5" />
            <b class="font-semibold text-foreground">{{ formatNumber(vacancy.responsesTotal) }}</b> откликов
          </span>
          <span class="inline-flex items-center gap-1" :title="`Последний раз видели ${formatDate(vacancy.lastSeenAt)}`">
            <Eye class="size-3.5" /> {{ seenAgo }} назад
          </span>
          <span>{{ formatDate(vacancy.publishedAt ?? vacancy.createdAt) }}</span>
        </div>
      </div>
    </div>

    <!-- Решение: справа на широких экранах, под названием на узких. -->
    <div
      v-if="vacancy.decision !== undefined"
      class="col-start-2 min-w-0 lg:col-start-3 lg:row-start-1 lg:border-l lg:border-border lg:pl-4"
    >
      <RowDecision :vacancy="vacancy" />
    </div>

    <RowActions
      :vacancy="vacancy"
      :accounts="accounts"
      :resumes="resumes"
      :scope-account-id="scopeAccountId"
      :engaged="engaged"
      :touch="touch"
      class="col-start-2 lg:col-start-3"
    />
  </article>
</template>
