<script setup lang="ts">
import { computed } from "vue"
import type { SalaryHistogramBucket } from "@otbor/contract"
import { StackedBar } from "@unovis/ts"
import { VisAxis, VisStackedBar, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { currencySymbol, tip, unwrap } from "./tip"

const props = defineProps<{ buckets: ReadonlyArray<SalaryHistogramBucket> }>()
const config: ChartConfig = { count: { label: "Вакансий", color: "var(--chart-1)" } }
const data = computed(() => [...props.buckets])

const short = (value: number): string => (value >= 1000 ? String(Math.round(value / 100) / 10) : String(value))
const compact = (value: number): string => (value >= 1000 ? `${short(value)}k` : short(value))

/** "80–120k" on the axis: the unit is written once, at the end of the range. */
const label = (bucket: SalaryHistogramBucket): string =>
  bucket.from === null
    ? `<${compact(bucket.to ?? 0)}`
    : bucket.to === null
      ? `${compact(bucket.from)}+`
      : bucket.from >= 1000 && bucket.to >= 1000
        ? `${short(bucket.from)}–${compact(bucket.to)}`
        : `${short(bucket.from)}–${short(bucket.to)}`

const triggers = {
  [StackedBar.selectors.bar]: (raw: unknown) => {
    const bucket = unwrap<SalaryHistogramBucket>(raw)
    return tip(`${label(bucket)} ${currencySymbol()}`, [{ label: "Вакансий", value: String(bucket.count), color: "var(--chart-1)" }])
  }
}
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-64">
    <VisXYContainer :data="data" :y-domain="[0, undefined]">
      <VisStackedBar :x="(_: SalaryHistogramBucket, index: number) => index" :y="(bucket: SalaryHistogramBucket) => bucket.count" color="var(--chart-1)" :rounded-corners="3" :bar-padding="0.1" />
      <VisAxis type="x" :tick-text-angle="-35" :tick-text-align="'right'" :num-ticks="data.length" :tick-format="(index: number) => (data[index] ? label(data[index]) : '')" :grid-line="false" />
      <VisAxis type="y" :num-ticks="4" :domain-line="false" />
      <ChartTooltip :triggers="triggers" />
    </VisXYContainer>
  </ChartContainer>
</template>
