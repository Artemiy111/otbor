<script setup lang="ts">
import { hhAccountColor, hhAccountName, useDefaultAccount } from "@/entities/hh-account"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const { accounts, defaultAccountId } = useDefaultAccount()
</script>

<template>
  <!-- Выбор действует там, где у страницы фильтр аккаунта стоит на «По умолчанию». -->
  <div v-if="accounts.length > 0" class="flex items-center gap-2">
    <span class="hidden text-xs text-muted-foreground xl:inline">Аккаунт в списках</span>
    <Select
      :model-value="defaultAccountId"
      @update:model-value="(value) => (defaultAccountId = String(value))"
    >
      <SelectTrigger
        class="h-8 w-[160px] text-xs sm:w-[200px]"
        aria-label="Аккаунт hh по умолчанию для списков и фильтров"
        title="Аккаунт hh по умолчанию для списков и фильтров"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
          <span class="inline-flex items-center gap-2">
            <span
              class="size-2.5 rounded-full"
              :style="{ backgroundColor: hhAccountColor(account) }"
            />
            {{ hhAccountName(account) }}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
