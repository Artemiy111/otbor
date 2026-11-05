<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"

defineProps<{ title: string; description?: string; empty?: boolean; emptyText?: string }>()
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-start justify-between gap-3 space-y-0 pb-2">
      <div class="space-y-1">
        <CardTitle class="text-base">{{ title }}</CardTitle>
        <CardDescription v-if="description">{{ description }}</CardDescription>
      </div>
      <slot name="actions" />
    </CardHeader>
    <CardContent>
      <p v-if="empty" class="py-10 text-center text-sm text-muted-foreground">
        {{ emptyText ?? "Нет данных для этой выборки" }}
      </p>
      <slot v-else />
    </CardContent>
  </Card>
</template>
