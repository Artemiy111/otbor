<script setup lang="ts">
import { themeChoice, type ThemeChoice } from "@/shared/lib/theme"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const options: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "auto", label: "Как в системе" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" }
]
</script>

<template>
  <Select
    :model-value="themeChoice"
    @update:model-value="(value) => (themeChoice = value as ThemeChoice)"
  >
    <SelectTrigger class="h-8 w-[130px] text-xs" aria-label="Тема оформления">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
