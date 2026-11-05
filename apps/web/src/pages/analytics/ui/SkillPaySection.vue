<script setup lang="ts">
import { computed, ref } from "vue"
import type { SkillSalary } from "@otbor/contract"
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger } from "@/shared/ui"
import BarList, { type BarRow } from "./BarList.vue"
import ChartCard from "./ChartCard.vue"
import SkillScatter from "./SkillScatter.vue"
import { rub, thousands } from "./tip"

const props = defineProps<{
  text: ReadonlyArray<SkillSalary>
  hh: ReadonlyArray<SkillSalary>
  /** Median of the whole selection, the baseline for the premium. */
  baseline: number | null
}>()

const source = ref<"text" | "hh">("text")
const metric = ref<"median" | "premium">("median")
const minSample = ref("5")
const topN = ref("20")

const premium = (skill: SkillSalary): number =>
  props.baseline === null || props.baseline === 0 ? 0 : Math.round((skill.median / props.baseline - 1) * 100)

const eligible = computed(() =>
  (source.value === "text" ? props.text : props.hh).filter((skill) => skill.n >= Number(minSample.value))
)
const ranked = computed(() =>
  [...eligible.value]
    .sort((a, b) => b.median - a.median)
    .slice(0, Number(topN.value))
)
const rows = computed<ReadonlyArray<BarRow>>(() =>
  ranked.value.map((skill) => ({
    label: skill.key,
    value: metric.value === "median" ? skill.median : premium(skill),
    hint: `${skill.n} вак. с зарплатой · ${skill.count} всего · медиана ${rub(skill.median)}`
  }))
)
const format = (value: number): string => (metric.value === "median" ? thousands(value) : `${value > 0 ? "+" : ""}${value}%`)

const descriptions = {
  text: "Ключевые слова из словаря, найденные в названии и описании вакансии.",
  hh: "Навыки, которые работодатель отметил в блоке «Ключевые навыки» на hh."
} as const
</script>

<template>
  <ChartCard
    title="Самые оплачиваемые навыки"
    :description="descriptions[source]"
    :empty="eligible.length === 0"
    empty-text="Мало вакансий с зарплатой: уменьшите минимальную выборку или расширьте пресет"
  >
    <template #actions>
      <Tabs v-model="source">
        <TabsList>
          <TabsTrigger value="text">В тексте вакансии</TabsTrigger>
          <TabsTrigger value="hh">Навыки hh</TabsTrigger>
        </TabsList>
      </Tabs>
    </template>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">Показатель</Label>
        <Select v-model="metric">
          <SelectTrigger class="w-[210px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="median">Медианная зарплата</SelectItem>
            <SelectItem value="premium">Премия к медиане выборки</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">Мин. вакансий с зарплатой</Label>
        <Select v-model="minSample">
          <SelectTrigger class="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="n in ['3', '5', '10', '20']" :key="n" :value="n">от {{ n }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">Сколько показать</Label>
        <Select v-model="topN">
          <SelectTrigger class="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="n in ['10', '20', '30']" :key="n" :value="n">{{ n }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <BarList
        :rows="rows"
        :value-label="metric === 'median' ? 'Медиана, ₽' : 'Премия'"
        :format="format"
        :color="source === 'text' ? 'var(--chart-1)' : 'var(--chart-2)'"
        :label-width="130"
      />
      <div>
        <p class="mb-1 text-xs text-muted-foreground">Спрос × деньги: размер точки — число вакансий с зарплатой</p>
        <SkillScatter :skills="eligible" />
      </div>
    </div>
  </ChartCard>
</template>
