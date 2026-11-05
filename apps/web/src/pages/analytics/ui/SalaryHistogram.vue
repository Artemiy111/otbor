<script setup lang="ts">
import { computed } from "vue"
import type { SalaryHistogramBucket } from "@otbor/contract"
import { StackedBar } from "@unovis/ts"
import { VisAxis, VisStackedBar, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { currencySymbol, thousands, tip } from "./tip"

const props = defineProps<{ buckets: ReadonlyArray<SalaryHistogramBucket> }>()
const config: ChartConfig = { count: { label: "Вакансий", color: "var(--chart-1)" } }
const data = computed(() => [...props.buckets])

const label = (bucket: SalaryHistogramBucket): string =>
  bucket.from === null
    ? `< ${thousands(bucket.to ?? 0)}`
    : bucket.to === null
      ? `${thousands(bucket.from)}+`
      : `${thousands(bucket.from)}–${thousands(bucket.to)}`

const triggers = {
  [StackedBar.selectors.bar]: (bucket: SalaryHistogramBucket) =>
    tip(`${label(bucket)} ${currencySymbol()}`, [{ label: "Вакансий", value: String(bucket.count), color: "var(--chart-1)" }])
}
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-64">
    <VisXYContainer :data="data" :y-domain="[0, undefined]">
      <VisStackedBar :x="(_: SalaryHistogramBucket, index: number) => index" :y="(bucket: SalaryHistogramBucket) => bucket.count" color="var(--chart-1)" :rounded-corners="3" :bar-padding="0.1" />
      <VisAxis type="x" :num-ticks="data.length" :tick-format="(index: number) => (data[index] ? label(data[index]) : '')" :grid-line="false" />
      <VisAxis type="y" :num-ticks="4" :domain-line="false" />
      <ChartTooltip :triggers="triggers" />
    </VisXYContainer>
  </ChartContainer>
</template>
