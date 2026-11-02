<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next"
import { cn } from "@/shared/lib"
import { Button } from "@/shared/ui"

const props = withDefaults(
  defineProps<{
    loading?: boolean
    label?: string
  }>(),
  {
    loading: false,
    label: "Refresh"
  }
)

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <Button variant="outline" size="sm" :disabled="props.loading" @click="emit('refresh')">
    <RefreshCw :class="cn('h-4 w-4', props.loading && 'animate-spin')" />
    {{ props.loading ? "Loading…" : props.label }}
  </Button>
</template>
