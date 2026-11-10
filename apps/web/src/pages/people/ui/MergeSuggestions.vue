<script setup lang="ts">
import { CircleAlert } from "@lucide/vue"
import type { PersonMergeSuggestion } from "@otbor/contract"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui"
import { PersonName } from "@/entities/person"

defineProps<{ suggestions: ReadonlyArray<PersonMergeSuggestion> }>()
</script>

<template>
  <Alert v-if="suggestions.length > 0" variant="warning" class="mb-4">
    <CircleAlert />
    <AlertTitle>Возможные дубликаты: {{ suggestions.length }}</AlertTitle>
    <AlertDescription>
      <ul class="mt-1 space-y-1.5">
        <li v-for="item in suggestions" :key="`${item.a}-${item.b}`" class="text-sm">
          <PersonName :id="item.a" /> и <PersonName :id="item.b" />
          <span class="text-muted-foreground"> — {{ item.reason }}.</span>
          Откройте одного и объедините с другим.
        </li>
      </ul>
    </AlertDescription>
  </Alert>
</template>
