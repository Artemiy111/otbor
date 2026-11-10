<script setup lang="ts">
import { OVERVIEW_WINDOWS } from "@/entities/overview"
import { cn } from "@/shared/lib"

/** Переключатель окна 7 / 14 / 30 дней: radiogroup с обычными кнопками. */
const days = defineModel<number>({ required: true })
</script>

<template>
  <div role="radiogroup" aria-label="Период обзора" class="inline-flex rounded-lg border bg-muted/50 p-0.5">
    <button
      v-for="option in OVERVIEW_WINDOWS"
      :key="option"
      type="button"
      role="radio"
      :aria-checked="days === option"
      :class="
        cn(
          'h-8 rounded-md px-3 text-sm font-medium tabular-nums text-muted-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          days === option ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
        )
      "
      @click="days = option"
    >
      {{ option }} дн.
    </button>
  </div>
</template>
