<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { MoreHorizontal } from "@lucide/vue"
import { cn } from "@/shared/lib"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    role="presentation"
    aria-hidden="true"
    :class="cn('flex size-9 items-center justify-center', props.class)"
  >
    <MoreHorizontal class="size-4" />
    <span class="sr-only">Ещё</span>
  </span>
</template>
