<script setup lang="ts">
import { useClipboard } from "@vueuse/core"
import { Check, Copy } from "@lucide/vue"

/** Команда терминала одной строкой; кнопка копирует её в буфер обмена. */
const props = defineProps<{ command: string }>()

const { copy, copied, isSupported } = useClipboard({ copiedDuring: 1800 })
</script>

<template>
  <span class="inline-flex max-w-full items-stretch overflow-hidden rounded-md border bg-muted/50 text-xs">
    <code class="min-w-0 select-all truncate px-2.5 py-1.5 font-mono">{{ props.command }}</code>
    <button
      v-if="isSupported"
      type="button"
      class="inline-flex shrink-0 items-center gap-1 border-l px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="copied ? 'Скопировано' : 'Скопировать команду'"
      @click="copy(props.command)"
    >
      <Check v-if="copied" class="size-3.5 text-success" />
      <Copy v-else class="size-3.5" />
      <span class="sr-only sm:not-sr-only">{{ copied ? "Скопировано" : "Копировать" }}</span>
    </button>
  </span>
</template>
