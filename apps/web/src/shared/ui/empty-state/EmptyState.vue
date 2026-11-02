<script setup lang="ts">
import { Inbox } from "@lucide/vue"

withDefaults(
  defineProps<{
    title?: string
    description?: string
  }>(),
  {
    title: "Пусто",
    description: undefined
  }
)
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <Inbox class="h-7 w-7 text-muted-foreground/60" />
    <p class="text-sm font-medium">{{ title }}</p>
    <p v-if="description" class="max-w-md text-sm text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
