<script setup lang="ts">
import { computed } from "vue"
import type { VacancySummary } from "@otbor/contract"
import { HumanStatusBadge, employerResponse, humanStatus } from "@/entities/auto-apply"
import { FIT_TONE, fitBand, fitPercent } from "../../model/filters"
import { applicationPath, cn, decisionReasonLabel, toneClasses, type StatusTone } from "@/shared/lib"
import { Badge } from "@/shared/ui"
import { lowerFirst } from "./model"

/**
 * Решение и отклик по вакансии: соответствие числом и тонкой шкалой, вердикт
 * словами и состояние отклика на общем словаре. Сервер без этих полей их не
 * присылает: тогда область не показывается совсем, а не рисует пустые значения.
 */
const props = defineProps<{ vacancy: VacancySummary }>()

const decision = computed(() => props.vacancy.decision)
const application = computed(() => props.vacancy.application ?? null)
const known = computed(() => props.vacancy.decision !== undefined)

const fit = computed(() => (decision.value ? fitPercent(decision.value.fit) : 0))
/** Отсечённая до оценки вакансия хранит соответствие 0: число не считалось, не показываем его. */
const scored = computed(() => decision.value != null && !(decision.value.verdict === "skip" && fit.value === 0))
const fitTone = computed(() => toneClasses(FIT_TONE[fitBand(fit.value)]))

const verdict = computed<{ text: string; tone: StatusTone; title?: string }>(() => {
  const value = decision.value
  if (value === null || value === undefined) return { text: "Ещё не оценена", tone: "neutral" }
  if (value.verdict === "apply") return { text: "Подходит", tone: "success" }
  if (value.verdict === "draft") return { text: "Нужна ваша проверка", tone: "info" }
  const reason = value.topReason
  if (reason === null) return { text: "Пропущена", tone: "neutral" }
  return {
    text: `Пропущена: ${lowerFirst(decisionReasonLabel(reason.code))}`,
    // Пропуск — обычный исход, а не ошибка: нейтральный тон.
    tone: "neutral",
    title: reason.detail === undefined ? undefined : `${decisionReasonLabel(reason.code)}: ${reason.detail}`
  }
})

const status = computed(() => (application.value === null ? null : humanStatus(application.value)))
const response = computed(() => (application.value === null ? null : employerResponse(application.value)))
</script>

<template>
  <div v-if="known" class="flex min-w-0 flex-col gap-2">
    <div v-if="decision && scored" class="space-y-1.5" :title="`Соответствие резюме: ${fit} из 100`">
      <div class="flex items-baseline justify-between gap-2">
        <span class="flex items-baseline gap-1.5">
          <span :class="cn('text-2xl font-semibold leading-none tabular-nums', fitTone.text)">{{ fit }}</span>
          <span class="text-xs text-muted-foreground">соответствие</span>
        </span>
        <span v-if="decision.verdict === 'apply'" class="text-xs tabular-nums text-muted-foreground" title="Соответствие с поправкой на свежесть">
          приоритет {{ Math.round(decision.priority) }}
        </span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-muted" role="presentation">
        <div :class="cn('h-full rounded-full', fitTone.dot)" :style="{ width: `${fit}%` }" />
      </div>
    </div>

    <p :class="cn('flex items-start gap-1.5 text-sm leading-snug', toneClasses(verdict.tone).text)" :title="verdict.title">
      <span :class="cn('mt-1.5 size-1.5 shrink-0 rounded-full', toneClasses(verdict.tone).dot)" aria-hidden="true" />
      <span class="min-w-0">{{ verdict.text }}</span>
    </p>

    <div v-if="application && status" class="relative z-10 flex flex-wrap items-center gap-1.5">
      <a
        :href="applicationPath(application.id)"
        class="min-w-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="`Отклик: ${status.text}`"
      >
        <HumanStatusBadge :status="status" :show-detail="false" />
      </a>
      <Badge v-if="response" :variant="response.tone" class="whitespace-nowrap" title="Ответ работодателя на hh">
        {{ response.label }}
      </Badge>
    </div>
    <p v-else-if="decision && decision.verdict !== 'skip'" class="text-xs text-muted-foreground">Отклика нет</p>
  </div>
</template>
