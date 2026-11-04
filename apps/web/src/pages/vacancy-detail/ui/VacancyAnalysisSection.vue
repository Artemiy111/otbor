<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { describeAnalysis, formatDate, type AnalysisRow, type AnalysisTone } from "@/shared/lib"

const props = defineProps<{ vacancyId: string }>()

const query = useQuery({
  key: () => vacancyKeys.analysis(props.vacancyId),
  query: () => vacancyApi.analysis(props.vacancyId)
})

const analysis = computed(() => query.data.value ?? null)
const view = computed(() => (analysis.value === null ? null : describeAnalysis(analysis.value.facts)))
const percent = (confidence: number) => `${Math.round(confidence * 100)}%`

const groups = computed(() => {
  const v = view.value
  if (v === null) return []
  return [
    { title: "О вакансии", rows: v.profile },
    { title: "Что просят в отклике", rows: v.requests },
    { title: "Условия", rows: v.conditions },
    { title: "Плюсы", rows: v.perks },
    { title: "Красные флаги по тексту", rows: v.redFlags }
  ].filter((group) => group.rows.length > 0)
})

const toneClass: Record<AnalysisTone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-400",
  warn: "font-medium text-red-300",
  muted: "text-muted-foreground"
}
const dot: Record<AnalysisTone, string> = {
  neutral: "bg-border",
  good: "bg-emerald-400",
  warn: "bg-red-300",
  muted: "bg-transparent"
}
const rowTitle = (row: AnalysisRow) => `${row.label}: уверенность модели ${percent(row.confidence)}`
</script>

<template>
  <section class="text-sm">
    <div class="mb-2 flex items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold">Анализ модели</h2>
      <span v-if="view" class="text-xs text-muted-foreground">
        определено {{ view.confident }} из {{ view.total }}
      </span>
    </div>

    <p v-if="query.isPending.value" class="text-xs text-muted-foreground">Загрузка</p>
    <p v-else-if="analysis === null || view === null" class="text-xs text-muted-foreground">
      Вакансия ещё не анализировалась.
    </p>
    <template v-else>
      <p v-if="groups.length === 0" class="text-xs text-muted-foreground">
        Модель ни в чём не уверена: значения не определены.
      </p>

      <div v-for="group in groups" :key="group.title" class="mt-3 first:mt-0">
        <h3 class="mb-1 border-b border-border pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {{ group.title }}
        </h3>
        <dl class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1">
          <template v-for="row in group.rows" :key="row.key">
            <dt class="flex items-center gap-1.5 text-muted-foreground" :title="rowTitle(row)">
              <span class="size-1.5 shrink-0 rounded-full" :class="dot[row.tone]" />
              {{ row.label }}
            </dt>
            <dd class="text-right" :class="toneClass[row.tone]" :title="rowTitle(row)">{{ row.value }}</dd>
            <dd class="w-8 text-right text-[11px] tabular-nums text-muted-foreground/70">{{ percent(row.confidence) }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="view.unknown.length > 0" class="mt-3">
        <h3 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Не определено</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">{{ view.unknown.join(", ") }}</p>
      </div>

      <p class="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {{ analysis.model }} · промпт {{ analysis.promptVersion }} · {{ formatDate(analysis.updatedAt) }} ·
        показаны значения с уверенностью от {{ percent(analysis.threshold) }}
      </p>
    </template>
  </section>
</template>
