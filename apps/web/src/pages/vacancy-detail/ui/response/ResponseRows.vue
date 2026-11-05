<script setup lang="ts">
import { Check, Circle } from "@lucide/vue"
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
      <Check v-if="row.application" class="size-4 shrink-0 text-emerald-600" />
      <Circle v-else class="size-4 shrink-0 text-muted-foreground" />
      <AccountChip :account-id="row.accountId" :accounts="accounts" :resume-ids="[row.resumeId]" :resumes="resumes" />
      <span class="min-w-0 flex-1 truncate" :class="row.selected ? 'font-medium' : 'text-muted-foreground'">
        {{ row.resumeTitle }}
      </span>
      <component
        :is="row.application ? 'a' : 'span'"
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
