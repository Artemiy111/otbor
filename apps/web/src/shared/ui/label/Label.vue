<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { Label, type LabelProps } from "reka-ui"
import { cn } from "@/shared/lib"

const props = defineProps<LabelProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <Label :class="cn('text-sm font-medium leading-none', props.class)">
    <slot />
  </Label>
</template>
