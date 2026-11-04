<script setup lang="ts">
import { LAYOUTS, type LayoutId } from "./layouts"

const model = defineModel<LayoutId>({ required: true })
</script>

<template>
  <div class="inline-flex rounded-md border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Вид страницы">
    <button
      v-for="layout in LAYOUTS"
      :key="layout.id"
      type="button"
      role="tab"
      :aria-selected="model === layout.id"
      :title="layout.hint"
      class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
      :class="model === layout.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      @click="model = layout.id"
    >
      {{ layout.label }}
    </button>
  </div>
</template>
