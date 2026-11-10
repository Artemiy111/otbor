<script setup lang="ts">
import { computed, ref } from "vue"
import { useElementSize } from "@vueuse/core"
import type { Overview } from "@otbor/contract"
import { VisArea, VisAxis, VisCrosshair, VisLine, VisScatter, VisStackedBar, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, Skeleton, type ChartConfig } from "@/shared/ui"
import { formatNumber } from "@/shared/lib"
import { tip } from "../../analytics/ui/tip"
import OverviewSection from "./OverviewSection.vue"

type Day = Overview["timeline"][number]

const props = defineProps<{
  timeline: ReadonlyArray<Day> | undefined
  loading: boolean
  days: number
}>()

const config: ChartConfig = {
  sent: { label: "Отправлено", color: "var(--chart-1)" },
  invited: { label: "Приглашения", color: "var(--chart-2)" },
  found: { label: "Найдено вакансий", color: "var(--chart-3)" }
}

const rows = computed(() => props.timeline ?? [])
const last = computed(() => rows.value.length - 1)
const totals = computed(() =>
  rows.value.reduce(
    (sum, row) => ({ sent: sum.sent + row.sent, invited: sum.invited + row.invited, found: sum.found + row.found }),
    { sent: 0, invited: 0, found: 0 }
  )
)
const allZero = computed(() => rows.value.every((row) => row.sent === 0 && row.invited === 0 && row.found === 0))

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })
const longFormat = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" })
const dateOf = (row: Day): Date => new Date(`${row.day}T00:00:00Z`)

const x = (_: Day, index: number) => index
const yFound = (row: Day) => row.found
/**
 * Сегодняшние сутки ярче остальных. Unovis красит серию целиком, поэтому
 * столбец дня вынесен в отдельную серию: в каждый день ненулевая только одна.
 */
const yPast = (row: Day, index: number) => (index === last.value ? 0 : row.sent)
const yToday = (row: Day, index: number) => (index === last.value ? row.sent : 0)
const BAR_COLORS = ["color-mix(in oklab, var(--chart-1) 50%, transparent)", "var(--chart-1)"]

/** Маркер приглашений стоит на верхушке столбца дня; в дни без приглашений его нет. */
const yInvited = (row: Day) => (row.invited > 0 ? row.sent : null)

/** Ширина графика решает, сколько подписей влезает: около 56 px на подпись. */
const chartBox = ref<HTMLElement | null>(null)
const { width: chartWidth } = useElementSize(chartBox)
const tickValues = computed(() => {
  const fit = Math.max(2, Math.floor((chartWidth.value || 480) / 56))
  const step = Math.max(1, Math.ceil(rows.value.length / fit))
  // Отсчёт от последнего дня, чтобы «сегодня» всегда имел подпись.
  return rows.value.map((_, index) => index).filter((index) => (last.value - index) % step === 0)
})
const tickFormat = (index: number) => {
  const row = rows.value[Math.round(index)]
  return row === undefined ? "" : dayFormat.format(dateOf(row))
}
const compact = (value: number) => (Number.isInteger(value) ? formatNumber(value) : "")

const template = (row: Day) => {
  const today = row.day === rows.value[last.value]?.day
  return tip(`${longFormat.format(dateOf(row))}${today ? " · сегодня" : ""}`, [
    { label: "Отправлено", value: formatNumber(row.sent), color: "var(--chart-1)" },
    { label: "Приглашения", value: formatNumber(row.invited), color: "var(--chart-2)" },
    { label: "Найдено вакансий", value: formatNumber(row.found), color: "var(--chart-3)" }
  ])
}
const crosshairX = (_: Day, index: number) => index
const xDomain = computed<[number, number]>(() => [-0.6, Math.max(rows.value.length - 1, 0) + 0.6])
const MARGIN = { left: 8, right: 8, top: 10, bottom: 4 } as const
</script>

<template>
  <OverviewSection :title="`По дням за ${props.days} дн.`" description="Сутки считаются по UTC, последний столбец — сегодня." body-class="flex flex-col">
    <div v-if="props.loading" class="space-y-3" aria-busy="true">
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-16 w-full" />
    </div>

    <p v-else-if="props.timeline === undefined" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      Данные по дням недоступны.
    </p>

    <div v-else ref="chartBox" class="flex h-full flex-col gap-4">
      <ul class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground tabular-nums">
        <li class="flex items-center gap-2">
          <span class="size-2.5 rounded-[3px]" style="background: var(--chart-1)" aria-hidden="true" />
          Отправлено <b class="font-semibold text-foreground">{{ formatNumber(totals.sent) }}</b>
        </li>
        <li class="flex items-center gap-2">
          <span class="size-2.5 rounded-full border-2" style="background: var(--card); border-color: var(--chart-2)" aria-hidden="true" />
          Приглашения <b class="font-semibold text-foreground">{{ formatNumber(totals.invited) }}</b>
        </li>
      </ul>

      <p v-if="allZero" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        За выбранный период ничего не отправлено и не найдено.
      </p>

      <template v-else>
        <ChartContainer :config="config" class="aspect-auto min-h-52 flex-1" role="img" :aria-label="`Отправлено откликов по дням, всего ${totals.sent}`">
          <VisXYContainer :data="rows" :margin="MARGIN" :y-domain="[0, undefined]" :x-domain="xDomain">
            <VisStackedBar :x="x" :y="[yPast, yToday]" :color="BAR_COLORS" :bar-padding="0.3" :rounded-corners="3" />
            <VisScatter
              :x="x"
              :y="yInvited"
              :size="10"
              color="var(--card)"
              stroke-color="var(--chart-2)"
              :stroke-width="2.5"
            />
            <VisAxis type="x" :tick-values="tickValues" :tick-format="tickFormat" :grid-line="false" :tick-line="false" />
            <VisAxis type="y" :num-ticks="4" :tick-format="compact" :domain-line="false" :tick-text-width="36" tick-text-align="right" />
            <VisCrosshair :x="crosshairX" :template="template" color="var(--chart-1)" />
            <ChartTooltip />
          </VisXYContainer>
        </ChartContainer>

        <div>
          <p class="mb-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span class="h-0.5 w-3 rounded-full" style="background: var(--chart-3)" aria-hidden="true" />
            Найдено вакансий <b class="font-semibold text-foreground">{{ formatNumber(totals.found) }}</b>
            <span>· своя шкала</span>
          </p>
          <ChartContainer :config="config" class="aspect-auto h-16" role="img" :aria-label="`Найдено вакансий по дням, всего ${totals.found}`">
            <VisXYContainer :data="rows" :margin="MARGIN" :y-domain="[0, undefined]" :x-domain="xDomain">
              <VisArea :x="x" :y="yFound" color="var(--chart-3)" :opacity="0.18" curve-type="monotoneX" />
              <VisLine :x="x" :y="yFound" color="var(--chart-3)" :line-width="2" curve-type="monotoneX" />
              <VisAxis type="y" :num-ticks="2" :tick-format="compact" :domain-line="false" :tick-text-width="36" tick-text-align="right" />
              <VisCrosshair :x="crosshairX" :template="template" color="var(--chart-3)" />
              <ChartTooltip />
            </VisXYContainer>
          </ChartContainer>
        </div>
      </template>
    </div>
  </OverviewSection>
</template>
