<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { SelectGroup, type SelectGroupProps } from "reka-ui"
import { cn } from "@/shared/lib"

const props = defineProps<SelectGroupProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <SelectGroup :class="cn('p-1', props.class)">
    <slot />
  </SelectGroup>
</template>
