<script setup lang="ts">
import { Badge } from "@/shared/ui"
import type { HumanStatus } from "../status"

/**
 * Один бейдж состояния отклика на едином словаре и под ним, при желании, одна
 * строка подробности (причина, время повтора). Слова и тон приходят готовыми
 * из `humanStatus`, поэтому список, страница отклика и сводка выглядят одинаково.
 */
withDefaults(defineProps<{ status: HumanStatus; showDetail?: boolean }>(), { showDetail: true })
</script>

<template>
  <div class="min-w-0">
    <Badge :variant="status.tone" :title="status.text" class="max-w-full whitespace-nowrap">
      {{ status.label }}
    </Badge>
    <div v-if="showDetail && status.detail" class="mt-1 text-xs text-muted-foreground">{{ status.detail }}</div>
  </div>
</template>
