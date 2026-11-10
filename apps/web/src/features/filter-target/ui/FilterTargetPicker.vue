<script setup lang="ts">
import { computed } from "vue"
import { Skeleton, HelpHint, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import type { FilterTargetState } from "../model/useFilterTarget"
import type { FilterTarget } from "../model/target"
import AccountModeChip from "./AccountModeChip.vue"

/**
 * Выбор аккаунта и резюме: общий для «Автооткликов» и «Фильтра откликов».
 * Аккаунты показаны чипами с их режимом, чтобы сразу было видно, где авто включено.
 * Сам выбор не меняет: страница решает (например, спросить про несохранённые правки).
 */
const props = defineProps<{
  state: FilterTargetState
  disabled?: boolean
  resumeHint?: string
}>()
const emit = defineEmits<{ select: [target: FilterTarget] }>()

/** Select не принимает пустое значение: это «все резюме аккаунта». */
const ACCOUNT_LEVEL = "__account__"

const resumeValue = computed(() => props.state.resumeId.value ?? ACCOUNT_LEVEL)
const pickResume = (value: unknown) => {
  const next = value === ACCOUNT_LEVEL || typeof value !== "string" ? null : value
  if (next === props.state.resumeId.value) return
  emit("select", { accountId: props.state.accountId.value, resumeId: next })
}
const pickAccount = (accountId: string) => {
  if (accountId === props.state.accountId.value) return
  emit("select", { accountId, resumeId: null })
}
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0 space-y-1.5">
      <Label class="text-xs">Аккаунт hh</Label>
      <div v-if="state.loading.value" class="flex gap-2"><Skeleton class="h-9 w-44 rounded-full" /></div>
      <div v-else class="flex flex-wrap gap-2" role="group" aria-label="Аккаунт hh">
        <AccountModeChip
          v-for="account in state.accounts.value"
          :key="account.id"
          :account="account"
          :selected="account.id === state.accountId.value"
          :disabled="disabled"
          @select="pickAccount(account.id)"
        />
      </div>
    </div>
    <div class="space-y-1.5 sm:w-80">
      <Label class="flex items-center gap-1 text-xs">
        Резюме
        <HelpHint v-if="resumeHint" :text="resumeHint" label="про выбор резюме" />
      </Label>
      <Select :model-value="resumeValue" :disabled="disabled || state.accountId.value === ''" @update:model-value="pickResume">
        <SelectTrigger class="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem :value="ACCOUNT_LEVEL">Все резюме аккаунта</SelectItem>
          <SelectItem v-for="resume in state.resumes.value" :key="resume.id" :value="resume.id">
            {{ resume.title }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
