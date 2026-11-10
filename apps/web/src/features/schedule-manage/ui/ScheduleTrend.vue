<script setup lang="ts">
import { computed } from "vue"

/** Мини-столбики: сколько новых вакансий дал каждый из последних запусков. */
const props = defineProps<{ values: ReadonlyArray<number> }>()

const max = computed(() => Math.max(1, ...props.values))
const label = computed(() => `Новых вакансий за последние запуски: ${props.values.join(", ")}`)
</script>

<template>
  <div
    v-if="values.length >= 2 && values.some((value) => value > 0)"
    class="flex h-5 items-end gap-0.5"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <span
      v-for="(value, index) in values"
      :key="index"
      class="w-1.5 rounded-sm bg-info/60"
      :style="{ height: `${Math.max(8, Math.round((value / max) * 100))}%` }"
    />
  </div>
</template>
