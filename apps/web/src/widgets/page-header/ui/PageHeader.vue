<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    backTo?: string
    backLabel?: string
  }>(),
  {
    description: undefined,
    backTo: undefined,
    backLabel: "Назад"
  }
)
</script>

<template>
  <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="space-y-1.5">
      <a
        v-if="backTo"
        :href="backTo"
        class="inline-flex items-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {{ backLabel }}
      </a>
      <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="description" class="max-w-3xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
