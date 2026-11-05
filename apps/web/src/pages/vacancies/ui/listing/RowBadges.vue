<script setup lang="ts">
import type { RowProps } from "./model"
import { AccountChip } from "@/entities/hh-account"
import { Badge, StatusBadge } from "@/shared/ui"

defineProps<RowProps & { showGate?: boolean }>()
</script>

<template>
  <Badge v-if="vacancy.archived" variant="neutral" class="text-[10px]">архив</Badge>
  <Badge v-if="vacancy.blacklisted" variant="destructive" class="text-[10px]">чёрный список</Badge>
  <Badge v-if="vacancy.analysed" variant="info" class="text-[10px]">ИИ-анализ</Badge>
  <StatusBadge v-if="showGate !== false && gate" :value="gate" />
  <AccountChip
    v-for="item in responded"
    :key="item.accountId"
    :account-id="item.accountId"
    :accounts="accounts"
    :resume-ids="item.resumeIds"
    :resumes="resumes"
  />
</template>
