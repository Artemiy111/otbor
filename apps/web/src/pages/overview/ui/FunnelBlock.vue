<script setup lang="ts">
import { computed } from "vue"
import { ChevronDown, ChevronRight } from "@lucide/vue"
import type { Overview } from "@otbor/contract"
import { cn, formatNumber } from "@/shared/lib"
import { Skeleton } from "@/shared/ui"
import { buildFunnel, buildSkipRows } from "../model/funnel"
import { formatRate } from "../model/hero"
import OverviewSection from "./OverviewSection.vue"

const props = defineProps<{
  funnel: Overview["funnel"] | undefined
  skipReasons: Overview["skipReasons"] | undefined
  days: number
  loading: boolean
}>()

const stages = computed(() => (props.funnel === undefined ? [] : buildFunnel(props.funnel)))
const skips = computed(() => buildSkipRows(props.skipReasons ?? []))
const empty = computed(() => stages.value.every((stage) => stage.value === 0))

/** Цвет полосы: первая группа спокойная, отклики — основной цвет, итог (приглашения) — успех. */
const barColor = (id: string): string =>
  id === "invited" ? "bg-success" : id === "found" || id === "matched" ? "bg-muted-foreground/40" : "bg-primary"
</script>

<template>
  <OverviewSection :title="`Воронка за ${props.days} дн.`" description="От найденной вакансии до приглашения. Проценты — доля от предыдущего шага.">
    <div v-if="props.loading" class="space-y-6" aria-busy="true">
      <div class="grid gap-4 md:grid-cols-6">
        <Skeleton v-for="index in 6" :key="index" class="h-24" />
      </div>
      <Skeleton class="h-28" />
    </div>

    <p v-else-if="props.funnel === undefined" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      Данные воронки недоступны.
    </p>

    <div v-else class="space-y-8">
      <ol class="flex flex-col gap-0 md:grid md:grid-cols-6 md:gap-0" aria-label="Этапы воронки">
        <li
          v-for="(stage, index) in stages"
          :key="stage.id"
          :class="
            cn(
              'relative flex flex-col gap-1.5 py-3 md:px-4 md:py-0',
              index === 0 ? 'md:pl-0' : '',
              index === stages.length - 1 ? 'md:pr-0' : '',
              stage.startsGroup && index > 0 && 'border-t md:border-l md:border-t-0'
            )
          "
        >
          <div class="flex items-center justify-between gap-2 md:block">
            <p class="text-xs text-muted-foreground md:min-h-8">{{ stage.label }}</p>
            <p :class="cn('text-2xl font-semibold leading-none tracking-tight tabular-nums md:mt-2', stage.value === 0 && 'text-muted-foreground')">
              {{ formatNumber(stage.value) }}
            </p>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div :class="cn('h-full rounded-full', barColor(stage.id))" :style="{ width: `${stage.width}%` }" />
          </div>
          <p class="flex min-h-4 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
            <span v-if="stage.rateFromPrevious !== null" class="inline-flex items-center gap-0.5 font-medium text-foreground">
              <ChevronRight class="hidden size-3 md:block" aria-hidden="true" />
              <ChevronDown class="size-3 md:hidden" aria-hidden="true" />
              {{ formatRate(stage.rateFromPrevious) }}
              <span class="sr-only">от предыдущего шага</span>
            </span>
            <span v-if="stage.aside">{{ stage.aside }}</span>
          </p>
        </li>
      </ol>

      <p v-if="empty" class="-mt-3 text-sm text-muted-foreground">За выбранный период данных пока нет.</p>

      <div>
        <h3 class="mb-3 text-sm font-semibold">Почему пропускаем</h3>
        <ul v-if="skips.length > 0" class="grid gap-x-10 gap-y-2.5 lg:grid-cols-2">
          <li v-for="row in skips" :key="row.code" class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1">
            <span class="truncate text-sm">{{ row.label }}</span>
            <span class="text-xs text-muted-foreground tabular-nums">
              <b class="text-sm font-medium text-foreground">{{ formatNumber(row.count) }}</b> · {{ row.share }} %
            </span>
            <div class="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div class="h-full rounded-full bg-muted-foreground/40" :style="{ width: `${row.width}%` }" />
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">Пропусков за период не было.</p>
      </div>
    </div>
  </OverviewSection>
</template>
