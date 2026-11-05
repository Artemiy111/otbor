<script setup lang="ts">
import { AccountChip } from "@/entities/hh-account"
import { applicationPath } from "@/shared/lib"
import { SentLetterButton } from "@/features/vacancy-apply"
import { useResponseRows, type ResponseSummaryProps } from "./useResponseRows"

const props = defineProps<ResponseSummaryProps>()
const { rows } = useResponseRows(props)
</script>

<template>
  <div class="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
    <div
      v-for="row in rows"
      :key="row.key"
      class="flex items-center gap-3 px-3 py-1.5"
      :class="row.selected ? 'bg-primary/5' : ''"
    >
      <AccountChip :account-id="row.accountId" :accounts="accounts" :resume-ids="[row.resumeId]" :resumes="resumes" />
      <span class="min-w-0 flex-1 truncate" :class="row.selected ? 'font-medium' : 'text-muted-foreground'">
        {{ row.resumeTitle }}
        <span v-if="row.selected" class="ml-1 text-xs font-normal text-muted-foreground">· выбрано</span>
      </span>
      <component
        :is="row.application ? 'a' : 'span'"
        :title="row.application ? (row.fromHh ? 'Статус на hh' : 'Статус в otbor: hh пока не сообщил свой') : undefined"
        :href="row.application ? applicationPath(row.application.id) : undefined"
        class="font-medium"
        :class="row.application ? 'hover:underline' : 'text-muted-foreground'"
      >
        {{ row.label }}
      </component>
      <span class="w-32 text-right text-xs text-muted-foreground">{{ row.when }}</span>
      <span class="w-8">
        <SentLetterButton v-if="row.selected && row.application" :vacancy-id="vacancyId" :account-id="row.accountId" />
      </span>
    </div>
  </div>
</template>
