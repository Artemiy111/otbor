<script setup lang="ts">
import { computed } from "vue"
import type { MarketTimelinePoint } from "@otbor/contract"
import { VisArea, VisAxis, VisCrosshair, VisLine, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { currencySymbol, tip } from "./tip"

const props = defineProps<{ points: ReadonlyArray<MarketTimelinePoint> }>()

const config = computed<ChartConfig>(() => ({
  count: { label: "Вакансий", color: "var(--chart-1)" },
  withSalary: { label: `С зарплатой в ${currencySymbol()}`, color: "var(--chart-2)" }
}))

const data = computed(() => props.points.map((point) => ({ ...point, day: new Date(`${point.date}T00:00:00Z`) })))
type Row = (typeof data.value)[number]

const x = (row: Row) => row.day.getTime()
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })
const template = (row: Row) =>
  tip(dayFmt.format(row.day), [
    { label: "Вакансий", value: String(row.count), color: "var(--chart-1)" },
    { label: `С зарплатой в ${currencySymbol()}`, value: String(row.withSalary), color: "var(--chart-2)" }
  ])
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-64" cursor>
    <VisXYContainer :data="data" :margin="{ left: 4, right: 8 }" :y-domain="[0, undefined]">
      <VisArea :x="x" :y="(row: Row) => row.count" color="var(--chart-1)" :opacity="0.25" />
      <VisLine :x="x" :y="(row: Row) => row.count" color="var(--chart-1)" />
      <VisLine :x="x" :y="(row: Row) => row.withSalary" color="var(--chart-2)" />
      <VisAxis type="x" :tick-format="(tick: number) => dayFmt.format(new Date(tick))" :num-ticks="7" :grid-line="false" />
      <VisAxis type="y" :num-ticks="4" :domain-line="false" />
      <VisCrosshair :template="template" color="var(--chart-1)" />
      <ChartTooltip />
    </VisXYContainer>
  </ChartContainer>
</template>
