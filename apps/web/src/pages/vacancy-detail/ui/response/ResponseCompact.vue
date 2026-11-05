<script setup lang="ts">
import { ChevronDown } from "@lucide/vue"
import { AccountChip } from "@/entities/hh-account"
import { applicationPath } from "@/shared/lib"
import { SentLetterButton } from "@/features/vacancy-apply"
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui"
import { toneClass, useResponseRows, type ResponseSummaryProps } from "./useResponseRows"

const props = defineProps<ResponseSummaryProps>()
const { selected, others } = useResponseRows(props)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <div
      v-if="selected"
      class="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5"
      :class="toneClass(selected)"
    >
      <span class="max-w-56 truncate text-xs text-muted-foreground">{{ selected.resumeTitle }}</span>
      <component
        :is="selected.application ? 'a' : 'span'"
        :href="selected.application ? applicationPath(selected.application.id) : undefined"
        class="font-semibold"
        :class="selected.application ? 'hover:underline' : 'text-muted-foreground'"
      >
        {{ selected.label }}
      </component>
      <span v-if="selected.when" class="text-xs text-muted-foreground">{{ selected.when }}</span>
      <SentLetterButton v-if="selected.application" :vacancy-id="vacancyId" :account-id="selected.accountId" label />
    </div>
    <Popover v-if="others.length > 0">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" class="h-8 gap-1">
          Ещё {{ others.length }}
          <ChevronDown class="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-80 space-y-1.5 p-2 text-sm">
        <a
          v-for="row in others"
          :key="row.key"
          :href="row.application ? applicationPath(row.application.id) : undefined"
          class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
        >
          <AccountChip :account-id="row.accountId" :accounts="accounts" :resume-ids="[row.resumeId]" :resumes="resumes" />
          <span class="min-w-0 flex-1 truncate text-xs">{{ row.resumeTitle }}</span>
          <span class="font-medium">{{ row.label }}</span>
          <span class="text-xs text-muted-foreground">{{ row.when }}</span>
        </a>
      </PopoverContent>
    </Popover>
  </div>
</template>
