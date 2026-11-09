<script setup lang="ts">
import { computed } from "vue"
import { cn } from "@/shared/lib"

const props = withDefaults(defineProps<{ harness: string | null | undefined; class?: string }>(), {
  class: undefined
})

/** Нормализованный id харнеса: `claude`, `opencode` или что-то неизвестное. */
const kind = computed(() => {
  const id = (props.harness ?? "").toLowerCase()
  if (id.includes("claude")) return "claude"
  if (id.includes("opencode")) return "opencode"
  return "other"
})
const initial = computed(() => (props.harness ?? "?").slice(0, 1).toUpperCase())
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg border',
        kind === 'claude' && 'border-[#d97757]/30 bg-[#d97757]/10 text-[#d97757]',
        kind === 'opencode' && 'border-border bg-foreground text-background',
        kind === 'other' && 'border-border bg-muted text-muted-foreground',
        props.class
      )
    "
    aria-hidden="true"
  >
    <!-- Claude: лучевая звезда -->
    <svg v-if="kind === 'claude'" viewBox="0 0 24 24" class="size-[60%]" fill="currentColor">
      <path
        d="M12 1.5l1.9 7.2 6.4-3.7-3.7 6.4 7.2 1.9-7.2 1.9 3.7 6.4-6.4-3.7L12 22.5l-1.9-7.2-6.4 3.7 3.7-6.4L0 10.7l7.2-1.9-3.7-6.4 6.4 3.7z"
      />
    </svg>
    <!-- OpenCode: квадратная скобка-терминал -->
    <svg v-else-if="kind === 'opencode'" viewBox="0 0 24 24" class="size-[60%]" fill="none">
      <path d="M5 4h14v16H5z" stroke="currentColor" stroke-width="2.4" />
      <path d="M9 9h6v6H9z" fill="currentColor" opacity=".45" />
    </svg>
    <span v-else class="text-sm font-semibold">{{ initial }}</span>
  </span>
</template>
