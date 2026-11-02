<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/shared/lib"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <th
    :class="
      cn(
        'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        props.class
      )
    "
  >
    <slot />
  </th>
</template>
