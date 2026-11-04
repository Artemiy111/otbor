<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { describeAnalysis, formatDate } from "@/shared/lib"

const props = defineProps<{ vacancyId: string }>()

const query = useQuery({
  key: () => vacancyKeys.analysis(props.vacancyId),
  query: () => vacancyApi.analysis(props.vacancyId)
})

const analysis = computed(() => query.data.value ?? null)
const view = computed(() => (analysis.value === null ? null : describeAnalysis(analysis.value.facts)))
const percent = (confidence: number) => `${Math.round(confidence * 100)}%`

const sectionTitle = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
const groupTitle = "mt-2 mb-0.5 text-xs text-muted-foreground"
</script>

<template>
  <section class="border-t border-border pt-3 first:border-t-0 first:pt-0">
    <h2 :class="sectionTitle">Анализ модели</h2>
    <p v-if="query.isPending.value" class="text-xs text-muted-foreground">Загрузка</p>
    <p v-else-if="analysis === null || view === null" class="text-xs text-muted-foreground">
      Вакансия ещё не анализировалась.
    </p>
    <template v-else>
      <p v-if="view.empty" class="text-xs text-muted-foreground">
        Модель ни в чём не уверена: значения не определены.
      </p>

      <dl v-if="view.profile.length > 0" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <template v-for="row in view.profile" :key="row.key">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="text-right" :title="`уверенность ${percent(row.confidence)}`">{{ row.value }}</dd>
        </template>
      </dl>

      <template v-if="view.requests.length > 0">
        <h3 :class="groupTitle">Что просят в отклике</h3>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <template v-for="row in view.requests" :key="row.key">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd
              class="text-right"
              :class="row.value === 'обязательно' ? 'font-medium' : ''"
              :title="`уверенность ${percent(row.confidence)}`"
            >
              {{ row.value }}
            </dd>
          </template>
        </dl>
      </template>

      <template v-if="view.conditions.length > 0">
        <h3 :class="groupTitle">Условия</h3>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <template v-for="row in view.conditions" :key="row.key">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd
              class="text-right"
              :class="row.warn ? 'text-red-300' : ''"
              :title="`уверенность ${percent(row.confidence)}`"
            >
              {{ row.value }}
            </dd>
          </template>
        </dl>
      </template>

      <template v-if="view.redFlags.length > 0">
        <h3 :class="groupTitle">Красные флаги по модели</h3>
        <ul class="space-y-0.5">
          <li v-for="row in view.redFlags" :key="row.key" :title="`уверенность ${percent(row.confidence)}`">
            <span class="font-medium text-red-300">{{ row.label }}</span>
          </li>
        </ul>
      </template>

      <p class="mt-2 text-[11px] text-muted-foreground">
        {{ analysis.model }} · {{ formatDate(analysis.updatedAt) }} · значения с уверенностью ниже
        {{ percent(analysis.threshold) }} не показаны
      </p>
    </template>
  </section>
</template>
