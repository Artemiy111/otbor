<script setup lang="ts">
import { CircleHelp } from "@lucide/vue"
import { Popover, PopoverContent, PopoverTrigger } from "../popover"

/**
 * A small "?" button that opens a short explanation. It is a popover rather
 * than a tooltip so that click, tap and keyboard focus all work, not only hover.
 */
defineProps<{ text: string; label?: string }>()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        :aria-label="label ? `Подсказка: ${label}` : 'Подсказка'"
        @click.stop
      >
        <CircleHelp class="size-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-72 whitespace-pre-line p-3 text-left text-xs font-normal normal-case leading-relaxed" side="top">
      {{ text }}
    </PopoverContent>
  </Popover>
</template>
