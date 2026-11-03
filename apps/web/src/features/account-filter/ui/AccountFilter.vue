<script setup lang="ts">
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountName } from "@/entities/hh-account"
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string; accounts: ReadonlyArray<HhAccountRecord> }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label for="account-filter" class="text-xs text-muted-foreground">Аккаунт</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="account-filter" class="w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все аккаунты</SelectItem>
        <SelectItem v-for="account in props.accounts" :key="account.id" :value="account.id">
          {{ hhAccountName(account) }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
