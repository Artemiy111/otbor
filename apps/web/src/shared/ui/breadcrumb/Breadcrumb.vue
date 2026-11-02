<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/shared/lib"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <nav aria-label="breadcrumb" :class="cn('text-sm', props.class)">
    <slot />
  </nav>
</template>
