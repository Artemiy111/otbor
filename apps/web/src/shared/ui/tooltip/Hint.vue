<script setup lang="ts">
import Tooltip from "./Tooltip.vue"
import TooltipContent from "./TooltipContent.vue"
import TooltipTrigger from "./TooltipTrigger.vue"

/** A shadcn tooltip around one element; renders the element alone when there is no text. */
defineProps<{ text?: string | null }>()
</script>

<template>
  <Tooltip v-if="text">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipContent class="max-w-xs whitespace-pre-line text-left">{{ text }}</TooltipContent>
  </Tooltip>
  <slot v-else />
</template>
