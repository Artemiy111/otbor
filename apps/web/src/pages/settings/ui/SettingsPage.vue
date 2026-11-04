<script setup lang="ts">
import { AccountChip, hhAccountName, useDefaultAccount } from "@/entities/hh-account"
import { apiEndpoint } from "@/shared/api"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const { accounts, defaultAccountId } = useDefaultAccount()
</script>

<template>
  <section>
    <PageHeader
      title="Настройки"
      description="Параметры этого кабинета. Хранятся в браузере и не меняют данные на сервере."
    />

    <div class="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Аккаунт по умолчанию</CardTitle>
          <CardDescription>
            Его используют страницы, где в фильтре выбрано «По умолчанию»: решения, отклики,
            вакансии, компании и резюме. На каждой странице можно выбрать другой аккаунт или все сразу.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="space-y-1.5">
            <Label for="settings-default-account" class="text-xs text-muted-foreground">Аккаунт</Label>
            <Select
              :model-value="defaultAccountId"
              @update:model-value="(value) => (defaultAccountId = String(value))"
            >
              <SelectTrigger id="settings-default-account" class="w-[280px]">
                <SelectValue placeholder="Нет аккаунтов" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                  {{ hhAccountName(account) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="accounts.length > 0" class="space-y-1.5">
            <div class="text-xs text-muted-foreground">Все аккаунты</div>
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              <AccountChip
                show-name
                v-for="account in accounts"
                :key="account.id"
                :account-id="account.id"
                :accounts="accounts"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Подключение</CardTitle>
          <CardDescription>Адрес API, к которому обращается кабинет.</CardDescription>
        </CardHeader>
        <CardContent>
          <code class="font-mono text-sm">{{ apiEndpoint }}</code>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
