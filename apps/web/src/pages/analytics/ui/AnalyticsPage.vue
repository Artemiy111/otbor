<script setup lang="ts">
import { computed, ref, watchEffect } from "vue"
import { useQuery } from "@pinia/colada"
import { marketApi, marketKeys } from "@/entities/market"
import { presetApi, presetKeys } from "@/entities/preset"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatNumber, workFormatText } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"
import BarList from "./BarList.vue"
import ChartCard from "./ChartCard.vue"
import DonutChart from "./DonutChart.vue"
import FlowChart from "./FlowChart.vue"
import SalaryBySeniority from "./SalaryBySeniority.vue"
import SalaryHistogram from "./SalaryHistogram.vue"
import SkillPaySection from "./SkillPaySection.vue"
import TimelineChart from "./TimelineChart.vue"
import { SENIORITY_ORDER, WORK_FORMAT_LABELS, activeCurrency, currencySymbol, money, seniorityLabel } from "./tip"

const presetId = ref("all")
const sinceDays = ref("0")
const currency = ref("RUB")

const presetsQuery = useQuery({
  key: () => presetKeys.list("all"),
  query: () => presetApi.list({})
})
const presets = computed(() => presetsQuery.data.value ?? [])

const query = useQuery({
  key: () => marketKeys.get(presetId.value, Number(sinceDays.value), currency.value),
  query: () =>
    marketApi.get({
      presetId: presetId.value === "all" ? undefined : presetId.value,
      sinceDays: Number(sinceDays.value) || undefined,
      currency: currency.value
    }),
  staleTime: 60_000
})
const data = computed(() => query.data.value)
watchEffect(() => {
  activeCurrency.value = data.value?.meta.currency ?? currency.value
})
// Currencies offered in the picker: the ones present in the selection, plus the chosen one.
const currencyOptions = computed(() => {
  const found = data.value?.meta.currencies ?? []
  return found.some((item) => item.code === currency.value)
    ? found
    : [...found, { code: currency.value, count: 0 }]
})
const symbol = computed(() => currencySymbol(activeCurrency.value))
const errorText = computed(() => (query.error.value === null ? null : describeError(query.error.value)))

const coverage = computed(() => {
  const meta = data.value?.meta
  return meta === undefined || meta.docs === 0 ? 0 : Math.round((meta.withSalary / meta.docs) * 100)
})

const seniorityRows = computed(() => {
  const buckets = data.value?.counts.seniority ?? []
  return [...buckets]
    .sort((a, b) => SENIORITY_ORDER.indexOf(a.key as never) - SENIORITY_ORDER.indexOf(b.key as never))
    .map((bucket) => ({ label: seniorityLabel(bucket.key), value: bucket.count }))
})
const formatLabel = (key: string): string => WORK_FORMAT_LABELS[key] ?? workFormatText(key)
const formatSlices = computed(() =>
  (data.value?.counts.workFormats ?? []).map((bucket) => ({ label: formatLabel(bucket.key), value: bucket.count }))
)
const areaRows = computed(() => (data.value?.counts.areas ?? []).map((b) => ({ label: b.key, value: b.count })))
const companyRows = computed(() => (data.value?.counts.companies ?? []).map((b) => ({ label: b.key, value: b.count })))
</script>

<template>
  <div>
    <PageHeader title="Аналитика рынка" description="Срезы по вакансиям корпуса: объём, зарплаты, навыки. Пресет сужает выборку для всех графиков сразу.">
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent>
      <div class="space-y-1.5">
        <Label for="market-preset" class="text-xs text-muted-foreground">Пресет</Label>
        <Select v-model="presetId">
          <SelectTrigger id="market-preset" class="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все вакансии</SelectItem>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.title }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="market-period" class="text-xs text-muted-foreground">Период публикации</Label>
        <Select v-model="sinceDays">
          <SelectTrigger id="market-period" class="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 дней</SelectItem>
            <SelectItem value="14">14 дней</SelectItem>
            <SelectItem value="30">30 дней</SelectItem>
            <SelectItem value="0">Всё время</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="market-currency" class="text-xs text-muted-foreground">Валюта зарплат</Label>
        <Select :key="data ? 'ready' : 'init'" v-model="currency">
          <SelectTrigger id="market-currency" class="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in currencyOptions" :key="item.code" :value="item.code">
              {{ item.code }}{{ item.count > 0 ? ` · ${item.count}` : "" }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </form>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <AlertTitle>Не удалось посчитать аналитику</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="!data && !errorText" class="grid gap-4 md:grid-cols-2">
      <Skeleton v-for="n in 4" :key="n" class="h-64" />
    </div>

    <div v-else-if="data" class="space-y-4">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Вакансий в выборке" :value="formatNumber(data.meta.docs)" :hint="`из ${formatNumber(data.meta.totalDocs)} в корпусе`" />
        <StatCard :label="`С зарплатой в ${symbol}`" :value="formatNumber(data.meta.withSalary)" :hint="`${coverage}% выборки`" />
        <StatCard label="Медианная зарплата" :value="data.salaries.overall ? money(data.salaries.overall.median) : '—'" :hint="data.salaries.overall ? `p25 ${money(data.salaries.overall.p25)}` : undefined" />
        <StatCard label="Верхний дециль" :value="data.salaries.overall ? money(data.salaries.overall.p90) : '—'" :hint="data.salaries.overall ? `p75 ${money(data.salaries.overall.p75)}` : undefined" />
      </div>

      <ChartCard title="Новые вакансии по дням" description="Сколько вакансий опубликовано и сколько из них называют зарплату в выбранной валюте" :empty="data.timeline.length === 0">
        <TimelineChart :points="data.timeline" />
      </ChartCard>

      <div class="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Грейды" description="Определены по названию и описанию" :empty="seniorityRows.length === 0">
          <BarList :rows="seniorityRows" value-label="Вакансий" :label-width="90" />
        </ChartCard>
        <ChartCard title="Формат работы" description="Вакансия может предлагать несколько форматов" :empty="formatSlices.length === 0">
          <DonutChart :slices="formatSlices" center-label="форматов" />
        </ChartCard>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Зарплата по грейдам" :description="`Середина вилки, ${symbol}/мес; группы от 3 вакансий с зарплатой`" :empty="data.salaries.bySeniority.length === 0">
          <SalaryBySeniority :groups="data.salaries.bySeniority" />
        </ChartCard>
        <ChartCard title="Распределение зарплат" :description="`Сколько вакансий попадает в каждую вилку, ${symbol}/мес`" :empty="data.meta.withSalary === 0">
          <SalaryHistogram :buckets="data.salaries.histogram" />
        </ChartCard>
      </div>

      <SkillPaySection :text="data.skills.text" :hh="data.skills.hh" :baseline="data.salaries.overall?.median ?? null" />

      <div class="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Города" description="Где больше всего вакансий" :empty="areaRows.length === 0">
          <BarList :rows="areaRows" value-label="Вакансий" color="var(--chart-3)" :label-width="140" />
        </ChartCard>
        <ChartCard title="Компании" description="Кто публикует больше всех" :empty="companyRows.length === 0">
          <BarList :rows="companyRows" value-label="Вакансий" color="var(--chart-4)" :label-width="150" />
        </ChartCard>
      </div>

      <ChartCard title="Грейд → формат работы" description="Толщина потока — число вакансий" :empty="data.flows.seniorityFormat.length === 0">
        <FlowChart :edges="data.flows.seniorityFormat" />
      </ChartCard>
    </div>
  </div>
</template>
