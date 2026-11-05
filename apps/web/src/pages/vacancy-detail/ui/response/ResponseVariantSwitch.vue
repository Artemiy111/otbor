<script setup lang="ts">
import { Hint } from "@/shared/ui"
import { RESPONSE_VARIANTS, type ResponseVariant } from "./variants"

const model = defineModel<ResponseVariant>({ required: true })
</script>

<template>
  <div class="inline-flex rounded-md border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Вид статуса отклика">
    <Hint v-for="variant in RESPONSE_VARIANTS" :key="variant.id" :text="variant.hint">
      <button
        type="button"
        role="tab"
        :aria-selected="model === variant.id"
        class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
        :class="model === variant.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        @click="model = variant.id"
      >
        {{ variant.label }}
      </button>
    </Hint>
  </div>
</template>
