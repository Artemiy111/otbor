<script setup lang="ts">
import { AccountOption, useDefaultAccount, VIEW_ALL } from "@/entities/hh-account"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

/**
 * Фильтр просмотра, а не настройка: какой аккаунт показывают списки с выбором
 * «как в шапке». Основной аккаунт здесь не меняется, это делается на странице аккаунтов.
 */
const { accounts, viewId, serverDefaultId } = useDefaultAccount()
</script>

<template>
  <div v-if="accounts.length > 0" class="flex items-center gap-2">
    <span class="hidden text-xs text-muted-foreground xl:inline">Показывать:</span>
    <Select :model-value="viewId" @update:model-value="(value) => (viewId = String(value))">
      <SelectTrigger
        class="h-8 w-[150px] text-xs sm:w-[240px]"
        aria-label="Какие аккаунты hh показывать в списках"
        title="Какие аккаунты hh показывать в списках. Основной аккаунт меняется на странице «Аккаунты hh»."
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="VIEW_ALL">Все аккаунты</SelectItem>
        <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
          <AccountOption :account="account">
            <span v-if="account.id === serverDefaultId" class="text-muted-foreground">· основной</span>
          </AccountOption>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
