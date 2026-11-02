<script setup lang="ts">
import { cn } from "@/shared/lib"
import { Card, CardContent } from "@/shared/ui"

const props = withDefaults(
  defineProps<{
    label: string
    value?: string | number
    hint?: string
    mono?: boolean
    class?: string
  }>(),
  {
    value: undefined,
    hint: undefined,
    mono: false,
    class: undefined
  }
)
</script>

<template>
  <Card :class="props.class">
    <CardContent class="space-y-1 p-4">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {{ props.label }}
      </p>
      <div :class="cn('text-lg font-semibold leading-tight', props.mono && 'font-mono text-sm')">
        <slot>{{ props.value }}</slot>
      </div>
      <p v-if="props.hint" class="text-xs text-muted-foreground">{{ props.hint }}</p>
    </CardContent>
  </Card>
</template>
