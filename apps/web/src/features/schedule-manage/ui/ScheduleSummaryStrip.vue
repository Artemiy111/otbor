<script setup lang="ts">
import { cn } from "@/shared/lib"
import type { ScheduleSummary } from "@/entities/schedule"

/** Четыре числа над списком; «с ошибками» нажимается и включает фильтр. */
defineProps<{ summary: ScheduleSummary; errorsActive?: boolean }>()
defineEmits<{ "toggle-errors": [] }>()
</script>

<template>
  <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="rounded-lg border bg-card p-4">
      <dt class="text-xs text-muted-foreground">Всего</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.total }}</dd>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <dt class="text-xs text-muted-foreground">Включено</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">
        {{ summary.enabled }}
        <span v-if="summary.total > summary.enabled" class="text-sm font-normal text-muted-foreground">
          из {{ summary.total }}
        </span>
      </dd>
    </div>
    <button
      type="button"
      :aria-pressed="errorsActive"
      :class="
        cn(
          'rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          errorsActive && 'border-danger/40'
        )
      "
      @click="$emit('toggle-errors')"
    >
      <span class="block text-xs text-muted-foreground">С ошибками</span>
      <span :class="cn('mt-1 block text-2xl font-semibold tabular-nums', summary.errors > 0 && 'text-danger')">
        {{ summary.errors }}
      </span>
    </button>
    <div class="rounded-lg border bg-card p-4">
      <dt class="text-xs text-muted-foreground">Выполняется сейчас</dt>
      <dd :class="cn('mt-1 text-2xl font-semibold tabular-nums', summary.running > 0 && 'text-info')">
        {{ summary.running }}
      </dd>
    </div>
  </dl>
</template>
