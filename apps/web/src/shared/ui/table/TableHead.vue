<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/shared/lib"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <th
    :class="
      cn(
        'h-9 px-2 text-left align-middle text-xs font-medium normal-case text-muted-foreground',
        props.class
      )
    "
  >
    <slot />
  </th>
</template>
