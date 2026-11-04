<script setup lang="ts">
import { hhAccountName, hhAccountHue, ALL_ACCOUNTS, useAccountScope } from "@/entities/hh-account"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const { accounts, accountId } = useAccountScope()
</script>

<template>
  <Select
    :model-value="accountId"
    @update:model-value="(value) => (accountId = String(value))"
  >
    <SelectTrigger class="h-8 w-[180px] text-xs sm:w-[220px]" aria-label="Аккаунт hh">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem :value="ALL_ACCOUNTS">Все аккаунты</SelectItem>
      <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
        <span class="inline-flex items-center gap-2">
          <span
            class="size-2.5 rounded-full"
            :style="{ backgroundColor: `hsl(${hhAccountHue(account.id)} 55% 42%)` }"
          />
          {{ hhAccountName(account) }}
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
