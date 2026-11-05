<script setup lang="ts">
import { computed } from "vue"
import type { SkillSalary } from "@otbor/contract"
import { Scatter } from "@unovis/ts"
import { VisAxis, VisScatter, VisXYContainer } from "@unovis/vue"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/shared/ui"
import { currencySymbol, money, thousands, tip } from "./tip"

const props = defineProps<{ skills: ReadonlyArray<SkillSalary> }>()
const config: ChartConfig = { skill: { label: "Навык", color: "var(--chart-4)" } }
const data = computed(() => [...props.skills])

const triggers = {
  [Scatter.selectors.point]: (d: SkillSalary) =>
    tip(d.key, [
      { label: "Вакансий с навыком", value: String(d.count) },
      { label: "Из них с зарплатой", value: String(d.n) },
      { label: "Медиана", value: money(d.median), color: "var(--chart-4)" }
    ])
}
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-72">
    <VisXYContainer :data="data" :x-domain="[0, undefined]">
      <VisScatter
        :x="(d: SkillSalary) => d.count"
        :y="(d: SkillSalary) => d.median"
        :size="(d: SkillSalary) => 4 + Math.sqrt(d.n)"
        :label="(d: SkillSalary) => (d.count > 40 || d.median > 280000 ? d.key : '')"
        :label-hide-overlapping="true"
        color="var(--chart-4)"
        :opacity="0.7"
      />
      <VisAxis type="x" label="Вакансий с навыком" :num-ticks="6" :grid-line="false" />
      <VisAxis type="y" :label="`Медианная зарплата, ${currencySymbol()}`" :tick-format="thousands" :num-ticks="5" :domain-line="false" />
      <ChartTooltip :triggers="triggers" />
    </VisXYContainer>
  </ChartContainer>
</template>
