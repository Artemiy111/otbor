<script setup lang="ts">
import type { RowProps } from "./model"
import { AccountChip } from "@/entities/hh-account"
import { Badge } from "@/shared/ui"

defineProps<RowProps>()
</script>

<template>
  <Badge v-if="vacancy.letterRequired" variant="warning" class="text-[10px]">hh требует письмо</Badge>
  <Badge v-if="vacancy.hasTest" variant="warning" class="text-[10px]">
    {{ vacancy.testRequired === false ? "тест необязательный" : "есть тест" }}
  </Badge>
  <Badge v-if="vacancy.archived" variant="neutral" class="text-[10px]">архив</Badge>
  <Badge v-if="vacancy.blacklisted" variant="destructive" class="text-[10px]">чёрный список</Badge>
  <Badge v-if="vacancy.analysed" variant="info" class="text-[10px]">ИИ-анализ</Badge>
  <AccountChip
    v-for="item in responded"
    :key="item.accountId"
    :account-id="item.accountId"
    :accounts="accounts"
    :resume-ids="item.resumeIds"
    :resumes="resumes"
  />
</template>
