<script setup lang="ts">
import ResponseChips from "./ResponseChips.vue"
import ResponseCompact from "./ResponseCompact.vue"
import ResponseRows from "./ResponseRows.vue"
import type { ResponseSummaryProps } from "./useResponseRows"
import type { ResponseVariant } from "./variants"

defineProps<ResponseSummaryProps & { variant: ResponseVariant }>()
</script>

<template>
  <ResponseRows v-if="variant === 'rows'" v-bind="$props" />
  <ResponseCompact v-else-if="variant === 'compact'" v-bind="$props" />
  <ResponseChips v-else v-bind="$props" />
</template>
