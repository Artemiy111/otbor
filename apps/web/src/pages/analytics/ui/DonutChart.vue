<script setup lang="ts">
import { computed } from "vue"
import { Donut } from "@unovis/ts"
import { VisDonut, VisSingleContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { formatNumber } from "@/shared/lib"
import { tip } from "./tip"

export interface Slice {
  readonly label: string
  readonly value: number
}

const props = defineProps<{ slices: ReadonlyArray<Slice>; centerLabel: string }>()

const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
const total = computed(() => props.slices.reduce((sum, slice) => sum + slice.value, 0))
const config = computed<ChartConfig>(() =>
  Object.fromEntries(props.slices.map((slice, index) => [slice.label, { label: slice.label, color: palette[index % palette.length] }]))
)
const triggers = {
  [Donut.selectors.segment]: (d: { data: Slice }) =>
    tip(d.data.label, [
      { label: "Вакансий", value: formatNumber(d.data.value) },
      { label: "Доля", value: `${Math.round((d.data.value / Math.max(total.value, 1)) * 100)}%` }
    ])
}
</script>

<template>
  <div class="flex flex-col items-center gap-3 sm:flex-row">
    <ChartContainer :config="config" class="aspect-square h-52 w-52 shrink-0">
      <VisSingleContainer :data="slices as Slice[]" :height="208">
        <VisDonut
          :value="(slice: Slice) => slice.value"
          :color="(_: Slice, index: number) => palette[index % palette.length]"
          :arc-width="26"
          :pad-angle="0.02"
          :central-label="formatNumber(total)"
          :central-sub-label="centerLabel"
        />
        <ChartTooltip :triggers="triggers" />
      </VisSingleContainer>
    </ChartContainer>
    <ul class="grid flex-1 gap-1.5 text-sm">
      <li v-for="(slice, index) in slices" :key="slice.label" class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 shrink-0 rounded-[2px]" :style="{ background: palette[index % palette.length] }" />
        <span class="flex-1 text-muted-foreground">{{ slice.label }}</span>
        <span class="font-mono tabular-nums">{{ formatNumber(slice.value) }}</span>
      </li>
    </ul>
  </div>
</template>
