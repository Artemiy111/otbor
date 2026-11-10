<script setup lang="ts">
import { computed } from "vue"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "@lucide/vue"
import { cn, toneClasses, type StatusTone } from "@/shared/lib"
import { Card, CardContent } from "@/shared/ui"

export interface StatDelta {
  /** Готовый текст, например «+12 %». */
  readonly text: string
  readonly direction: "up" | "down" | "flat"
  /** По умолчанию: вверх - success, вниз - danger, ровно - neutral. */
  readonly tone?: StatusTone
}

const props = withDefaults(
  defineProps<{
    label: string
    value?: string | number
    hint?: string
    /** Моноширинное мелкое значение (id, версия). */
    mono?: boolean
    /** Окрашивает значение; без тона значение нейтральное. */
    tone?: StatusTone
    delta?: StatDelta
    /** Вся карточка становится ссылкой. */
    href?: string
    class?: string
  }>(),
  {
    value: undefined,
    hint: undefined,
    mono: false,
    tone: undefined,
    delta: undefined,
    href: undefined,
    class: undefined
  }
)

/** Длинные строки (даты, названия) не раздуваем до размера числа. */
const heroValue = computed(() => {
  if (props.mono) return false
  if (typeof props.value === "number") return true
  return props.value !== undefined && props.value.length <= 10
})

const valueClass = computed(() =>
  cn(
    "font-semibold leading-tight tabular-nums",
    props.mono
      ? "font-mono text-sm break-all"
      : heroValue.value
        ? "text-2xl tracking-tight lg:text-3xl"
        : "text-base",
    props.tone !== undefined && props.tone !== "neutral" ? toneClasses(props.tone).text : "text-foreground"
  )
)

const deltaTone = computed<StatusTone>(() => {
  const delta = props.delta
  if (delta === undefined) return "neutral"
  if (delta.tone !== undefined) return delta.tone
  return delta.direction === "up" ? "success" : delta.direction === "down" ? "danger" : "neutral"
})

const DeltaIcon = computed(() =>
  props.delta?.direction === "up"
    ? ArrowUpRight
    : props.delta?.direction === "down"
      ? ArrowDownRight
      : ArrowRight
)
</script>

<template>
  <component
    :is="props.href ? 'a' : 'div'"
    :href="props.href"
    :class="
      cn(
        'block rounded-xl outline-none',
        props.href &&
          'group transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )
    "
  >
    <Card
      :class="
        cn(
          'h-full',
          props.href && 'transition-colors group-hover:border-primary/40 group-hover:bg-accent/50',
          props.class
        )
      "
    >
      <CardContent class="space-y-2 p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="truncate text-sm font-medium text-muted-foreground">{{ props.label }}</p>
          <ArrowUpRight
            v-if="props.href"
            class="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </div>
        <div :class="valueClass">
          <slot>{{ props.value }}</slot>
        </div>
        <div v-if="props.hint || props.delta" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span
            v-if="props.delta"
            :class="cn('inline-flex items-center gap-0.5 font-medium tabular-nums', toneClasses(deltaTone).text)"
          >
            <component :is="DeltaIcon" class="size-3.5" aria-hidden="true" />
            {{ props.delta.text }}
          </span>
          <span v-if="props.hint" class="text-muted-foreground">{{ props.hint }}</span>
        </div>
      </CardContent>
    </Card>
  </component>
</template>
