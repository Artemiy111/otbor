<script setup lang="ts">
import { computed } from "vue"
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, LoaderCircle, OctagonAlert, Pause } from "@lucide/vue"
import { cn, toneClasses, type StatusTone } from "@/shared/lib"
import { Skeleton } from "@/shared/ui"
import type { HeroNumber } from "../model/hero"
import type { Verdict } from "../model/verdict"

const props = defineProps<{
  verdict: Verdict
  numbers: ReadonlyArray<HeroNumber> | null
}>()

/** Тон только подкрашивает рамку и подложку, баннером блок не становится. */
const SURFACE: Record<StatusTone, string> = {
  success: "border-success/30 bg-success-muted",
  info: "border-info/30 bg-info-muted",
  warning: "border-warning/35 bg-warning-muted",
  danger: "border-danger/35 bg-danger-muted",
  neutral: "border-border bg-card"
}

const GLYPHS = {
  ok: CircleCheck,
  attention: CircleAlert,
  stop: OctagonAlert,
  idle: Pause,
  loading: LoaderCircle
} as const

const glyph = computed(() => GLYPHS[props.verdict.glyph])
const tone = computed(() => toneClasses(props.verdict.tone))

/** Дельта: направление только в иконке и знаке, цвет — второстепенный сигнал. */
const deltaTone = (direction: "up" | "down" | "flat"): string =>
  direction === "up" ? "text-success" : direction === "down" ? "text-warning" : "text-muted-foreground"
const deltaIcon = (direction: "up" | "down" | "flat") =>
  direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight
</script>

<template>
  <section
    aria-label="Общее состояние"
    :class="cn('flex flex-col gap-6 rounded-2xl border p-5 sm:p-6', SURFACE[props.verdict.tone])"
  >
    <div class="flex min-w-0 items-start gap-4">
      <span
        :class="cn('mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border bg-background/70', tone.border, tone.text)"
        aria-hidden="true"
      >
        <component :is="glyph" :class="cn('size-6', props.verdict.glyph === 'loading' && 'animate-spin motion-reduce:animate-none')" />
      </span>
      <div class="min-w-0 space-y-1.5">
        <h2 class="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl" aria-live="polite">
          {{ props.verdict.headline }}
        </h2>
        <p v-if="props.verdict.detail" class="max-w-2xl text-sm text-muted-foreground text-pretty">
          {{ props.verdict.detail }}
        </p>
      </div>
    </div>

    <dl v-if="props.numbers" class="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-border/70 pt-5 sm:grid-cols-4">
      <div v-for="number in props.numbers" :key="number.id" class="min-w-0">
        <dt class="truncate text-xs text-muted-foreground">{{ number.label }}</dt>
        <dd class="mt-1">
          <a
            v-if="number.href"
            :href="number.href"
            class="block rounded-md text-2xl font-semibold leading-none tracking-tight tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >{{ number.value }}</a>
          <span v-else class="block text-2xl font-semibold leading-none tracking-tight tabular-nums">{{ number.value }}</span>
          <span class="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
            <span v-if="number.delta" :class="cn('inline-flex items-center gap-0.5 font-medium', deltaTone(number.delta.direction))">
              <component :is="deltaIcon(number.delta.direction)" class="size-3.5" aria-hidden="true" />{{ number.delta.text }}
            </span>
            <span v-if="number.hint">{{ number.hint }}</span>
          </span>
        </dd>
      </div>
    </dl>
    <div v-else class="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-border/70 pt-5 sm:grid-cols-4">
      <div v-for="index in 4" :key="index" class="space-y-2">
        <Skeleton class="h-3 w-24" />
        <Skeleton class="h-7 w-16" />
        <Skeleton class="h-3 w-20" />
      </div>
    </div>
  </section>
</template>
