<script setup lang="ts">
import { computed } from "vue"
import type { SalaryGroup } from "@otbor/contract"
import { GroupedBar } from "@unovis/ts"
import { VisAxis, VisGroupedBar, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { SENIORITY_ORDER, money, seniorityLabel, thousands, tip, unwrap } from "./tip"

const props = defineProps<{ groups: ReadonlyArray<SalaryGroup> }>()

const config: ChartConfig = {
  p25: { label: "25-й перцентиль", color: "var(--chart-2)" },
  median: { label: "Медиана", color: "var(--chart-1)" },
  p75: { label: "75-й перцентиль", color: "var(--chart-3)" }
}
const data = computed(() =>
  [...props.groups].sort(
    (a, b) => SENIORITY_ORDER.indexOf(a.key as never) - SENIORITY_ORDER.indexOf(b.key as never)
  )
)
const colors = [config.p25!.color!, config.median!.color!, config.p75!.color!]

const triggers = {
  [GroupedBar.selectors.bar]: (raw: unknown) => {
    const row = unwrap<SalaryGroup>(raw)
    return tip(`${seniorityLabel(row.key)} · ${row.n} вак.`, [
      { label: "p25", value: money(row.p25), color: colors[0] },
      { label: "Медиана", value: money(row.median), color: colors[1] },
      { label: "p75", value: money(row.p75), color: colors[2] },
      { label: "p90", value: money(row.p90) }
    ])
  }
}
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-64">
    <VisXYContainer :data="data" :y-domain="[0, undefined]">
      <VisGroupedBar
        :x="(_: SalaryGroup, index: number) => index"
        :y="[(row: SalaryGroup) => row.p25, (row: SalaryGroup) => row.median, (row: SalaryGroup) => row.p75]"
        :color="colors"
        :rounded-corners="3"
        :group-padding="0.2"
      />
      <VisAxis type="x" :num-ticks="data.length" :tick-format="(index: number) => seniorityLabel(data[index]?.key ?? '')" :grid-line="false" />
      <VisAxis type="y" :tick-format="thousands" :num-ticks="5" :domain-line="false" />
      <ChartTooltip :triggers="triggers" />
    </VisXYContainer>
  </ChartContainer>
  <div class="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
    <span v-for="(color, index) in colors" :key="color" class="flex items-center gap-1.5">
      <span class="h-2.5 w-2.5 rounded-[2px]" :style="{ background: color }" />
      {{ ["25-й перцентиль", "Медиана", "75-й перцентиль"][index] }}
    </span>
  </div>
</template>
