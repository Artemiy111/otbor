<script setup lang="ts">
import { Users } from "@lucide/vue"

/** Принятый в проекте кружок: цвет аккаунта + инициалы или код резюме. */
withDefaults(
  defineProps<{
    color?: string | null
    text?: string | null
    size?: "sm" | "md"
  }>(),
  { color: null, text: null, size: "sm" }
)
</script>

<template>
  <span
    v-if="color"
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :class="size === 'md' ? 'size-6 text-[10px]' : 'size-5 text-[10px]'"
    :style="{ backgroundColor: color }"
    aria-hidden="true"
  >{{ text }}</span>
  <span
    v-else
    class="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    :class="size === 'md' ? 'size-6' : 'size-5'"
    aria-hidden="true"
  ><Users class="size-3" /></span>
</template>
