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
  <!-- Три сегмента всегда видны: тема переключается одним кликом, без наведения. -->
  <div
    role="radiogroup"
    aria-label="Тема оформления"
    class="flex h-8 items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="themeChoice === option.value"
      :aria-label="option.label"
      :title="option.label"
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      :class="themeChoice === option.value ? 'bg-background text-foreground shadow-sm' : ''"
      @click="themeChoice = option.value"
    >
      <component :is="option.icon" class="size-3.5" />
    </button>
  </div>
</template>
