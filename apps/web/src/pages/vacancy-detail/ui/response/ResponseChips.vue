<script setup lang="ts">
import { AccountChip } from "@/entities/hh-account"
import { applicationPath } from "@/shared/lib"
import { SentLetterButton } from "@/features/vacancy-apply"
import { Badge } from "@/shared/ui"
import { toneClass, useResponseRows, type ResponseSummaryProps } from "./useResponseRows"

const props = defineProps<ResponseSummaryProps>()
const { rows } = useResponseRows(props)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <div
      v-for="row in rows"
      :key="row.key"
      class="flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5"
      :class="[toneClass(row), row.selected ? 'ring-2 ring-primary/40' : '']"
    >
      <AccountChip :account-id="row.accountId" :accounts="accounts" :resume-ids="[row.resumeId]" :resumes="resumes" />
      <span class="max-w-48 truncate text-xs text-muted-foreground">{{ row.resumeTitle }}</span>
      <component
        :is="row.application ? 'a' : 'span'"
        :href="row.application ? applicationPath(row.application.id) : undefined"
        class="font-semibold"
        :class="row.application ? 'hover:underline' : 'text-muted-foreground'"
      >
        {{ row.label }}
      </component>
      <span v-if="row.when" class="text-xs text-muted-foreground">{{ row.when }}</span>
      <Badge v-if="row.fromHh" variant="neutral" class="text-[10px]">hh</Badge>
      <SentLetterButton v-if="row.selected && row.application" :vacancy-id="vacancyId" :account-id="row.accountId" />
    </div>
  </div>
</template>
