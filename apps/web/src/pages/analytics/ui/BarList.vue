<script setup lang="ts">
import { computed } from "vue"
import { StackedBar } from "@unovis/ts"
import { VisAxis, VisStackedBar, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { tip, unwrap } from "./tip"

export interface BarRow {
  readonly label: string
  readonly value: number
  /** Second tooltip line, e.g. the sample size. */
  readonly hint?: string
}

const props = withDefaults(
  defineProps<{
    rows: ReadonlyArray<BarRow>
    valueLabel: string
    color?: string
    format?: (value: number) => string
    labelWidth?: number
  }>(),
  { color: "var(--chart-1)", format: (value: number) => String(value), labelWidth: 120 }
)

const display = computed(() => [...props.rows].reverse())
const config = computed<ChartConfig>(() => ({ value: { label: props.valueLabel, color: props.color } }))
const height = computed(() => Math.max(props.rows.length * 28 + 24, 120))

const x = (_: BarRow, index: number) => index
const y = (row: BarRow) => row.value
const triggers = computed(() => ({
  [StackedBar.selectors.bar]: (raw: unknown) => {
    const row = unwrap<BarRow>(raw)
    return tip(row.label, [
      { label: props.valueLabel, value: props.format(row.value), color: props.color },
      ...(row.hint === undefined ? [] : [{ label: row.hint, value: "" }])
    ])
  }
}))
const tickFormat = (index: number) => {
  return display.value[index]?.label ?? ""
}
</script>

<template>
  <ChartContainer :config="config" :style="{ height: `${height}px` }" class="aspect-auto">
    <VisXYContainer :data="display" :height="height" :margin="{ left: labelWidth, right: 12 }" :y-domain="[0, undefined]">
      <VisStackedBar :x="x" :y="y" :color="color" orientation="horizontal" :bar-padding="0.25" :rounded-corners="3" />
      <VisAxis type="y" :num-ticks="rows.length" :tick-format="tickFormat" :tick-text-width="labelWidth - 12" tick-text-fit-mode="trim" tick-text-align="right" :grid-line="false" :domain-line="false" :tick-line="false" />
      <VisAxis type="x" :num-ticks="4" :tick-format="format" :domain-line="false" />
      <ChartTooltip :triggers="triggers" />
    </VisXYContainer>
  </ChartContainer>
</template>
