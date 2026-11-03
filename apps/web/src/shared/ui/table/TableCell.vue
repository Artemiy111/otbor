<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/shared/lib"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <td :class="cn('px-2 py-2 align-top', props.class)">
    <slot />
  </td>
</template>
