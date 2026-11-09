<script setup lang="ts">
import { computed } from "vue"
import type { FunnelStage } from "../model/funnel"

/**
 * Санкей воронки: поток вакансий слева направо. Сверху остаётся то, что прошло
 * правило, отсечённое уходит вниз янтарной лентой. Ширина потока пропорциональна
 * числу вакансий, поэтому сразу видно, какое правило «режет» больше всех.
 */

const props = defineProps<{ stages: ReadonlyArray<FunnelStage> }>()

const W = 720
const H = 84
const GAP = 7
const NODE = 8
const TOP = 6
const LABEL_Y = TOP + H + GAP + 18

const nf = new Intl.NumberFormat("ru-RU")
const max = computed(() => Math.max(1, props.stages[0]?.count ?? 1))
const height = (count: number) => Math.max(count === 0 ? 0 : 2, (count / max.value) * H)

const xs = computed(() => {
  const n = props.stages.length
  const span = W - NODE - 80
  return props.stages.map((_, index) => 40 + (n === 1 ? 0 : (index * span) / (n - 1)))
})

const ribbon = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): string => {
  const mid = (x0 + x1) / 2
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1 + h1} C${mid},${y1 + h1} ${mid},${y0 + h0} ${x0},${y0 + h0} Z`
}

const parts = computed(() =>
  props.stages.map((stage, index) => {
    const x = xs.value[index]!
    const h = height(stage.count)
    const prev = index === 0 ? null : props.stages[index - 1]!
    const prevX = index === 0 ? 0 : xs.value[index - 1]!
    const prevH = prev === null ? 0 : height(prev.count)
    const dropped = prev === null ? 0 : Math.max(0, prev.count - stage.count)
    const dropH = prev === null ? 0 : Math.max(dropped === 0 ? 0 : 2, prevH - h)
    return {
      stage,
      x,
      h,
      dropped,
      dropH,
      pass: prev === null ? null : ribbon(prevX + NODE, TOP, h, x, TOP, h),
      drop:
        prev === null || dropH === 0
          ? null
          : ribbon(prevX + NODE, TOP + h, dropH, x, TOP + h + GAP, dropH),
      share: prev === null || prev.count === 0 ? 1 : stage.count / prev.count
    }
  })
)
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${LABEL_Y + 18}`" class="w-full" role="img" aria-label="Воронка правил">
    <g v-for="(part, index) in parts" :key="part.stage.id">
      <path v-if="part.pass" :d="part.pass" class="fill-emerald-500/20" />
      <path v-if="part.drop" :d="part.drop" class="fill-amber-500/35" />
      <rect
        v-if="part.drop"
        :x="part.x"
        :y="TOP + part.h + GAP"
        :width="NODE"
        :height="part.dropH"
        rx="1.5"
        class="fill-amber-500"
      />
      <rect :x="part.x" :y="TOP" :width="NODE" :height="part.h" rx="1.5" class="fill-emerald-500" />
      <text
        v-if="part.drop && part.dropH >= 10"
        :x="part.x - 4"
        :y="TOP + part.h + GAP + part.dropH / 2 + 3.5"
        text-anchor="end"
        class="fill-amber-600 text-[10px] tabular-nums dark:fill-amber-400"
      >
        −{{ nf.format(part.dropped) }}
      </text>
      <text
        :x="part.x + NODE / 2"
        :y="LABEL_Y - 11"
        :text-anchor="index === 0 ? 'start' : index === parts.length - 1 ? 'end' : 'middle'"
        :dx="index === 0 ? -NODE / 2 : index === parts.length - 1 ? NODE / 2 : 0"
        class="fill-foreground text-[11px] font-semibold tabular-nums"
      >
        {{ nf.format(part.stage.count) }}
      </text>
      <text
        :x="part.x + NODE / 2"
        :y="LABEL_Y + 2"
        :text-anchor="index === 0 ? 'start' : index === parts.length - 1 ? 'end' : 'middle'"
        :dx="index === 0 ? -NODE / 2 : index === parts.length - 1 ? NODE / 2 : 0"
        class="fill-muted-foreground text-[10px]"
      >
        {{ part.stage.label.length > 16 ? `${part.stage.label.slice(0, 15)}…` : part.stage.label }}
      </text>
      <title>{{ part.stage.title }}: {{ nf.format(part.stage.count) }}{{ part.dropped > 0 ? `, отсекло ${nf.format(part.dropped)}` : "" }}</title>
    </g>
  </svg>
</template>
