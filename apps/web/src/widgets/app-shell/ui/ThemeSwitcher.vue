<script setup lang="ts">
import { Monitor, Moon, Sun } from "@lucide/vue"
import { themeChoice, type ThemeChoice } from "@/shared/lib/theme"

const options = [
  { value: "auto", label: "Как в системе", icon: Monitor },
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon }
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: string; icon: unknown }>
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Тема оформления"
    class="group/theme flex h-8 items-center rounded-md border border-border bg-background p-0.5"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="themeChoice === option.value"
      :aria-label="option.label"
      :title="option.label"
      class="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[5px] text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="
        themeChoice === option.value
          ? 'bg-accent text-foreground'
          : 'w-0 opacity-0 group-hover/theme:w-7 group-hover/theme:opacity-100 group-focus-within/theme:w-7 group-focus-within/theme:opacity-100'
      "
      @click="themeChoice = option.value"
    >
      <component :is="option.icon" class="size-4" />
    </button>
  </div>
</template>
