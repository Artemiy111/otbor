<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { CrawlSchedule } from "@otbor/contract"
import {
  mergeOptions,
  optionText,
  parseInterval,
  parseOptionalInt,
  type ScheduleUpsertInput
} from "@/entities/schedule"
import { telegramAccountApi, telegramAccountKeys } from "@/entities/telegram-account"
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import ScheduleFormShell from "./ScheduleFormShell.vue"

const props = defineProps<{ schedule?: CrawlSchedule | null; saving: boolean }>()
const emit = defineEmits<{ submit: [input: ScheduleUpsertInput]; cancel: [] }>()

const accountsQuery = useQuery({ key: () => telegramAccountKeys.list(), query: () => telegramAccountApi.list() })
const accounts = computed(() => accountsQuery.data.value ?? [])

const account = ref(props.schedule?.targetId ?? "")
const interval = ref(String(props.schedule?.intervalMinutes ?? 60))
const enabled = ref(props.schedule?.enabled ?? true)
const dialogs = ref(optionText(props.schedule?.options ?? {}, "dialogs"))
const messages = ref(optionText(props.schedule?.options ?? {}, "messages"))
const error = ref<string | null>(null)

const submit = () => {
  if (account.value === "") return void (error.value = "Выберите аккаунт Telegram.")
  const minutes = parseInterval(interval.value)
  if (!minutes.ok) return void (error.value = minutes.error)
  const chats = parseOptionalInt(dialogs.value, "Диалогов за запуск", 1, 100)
  if (!chats.ok) return void (error.value = chats.error)
  const perChat = parseOptionalInt(messages.value, "Сообщений на диалог", 1, 200)
  if (!perChat.ok) return void (error.value = perChat.error)
  error.value = null
  emit("submit", {
    ...(props.schedule ? { id: props.schedule.id } : {}),
    kind: "telegram_sync",
    targetId: account.value,
    intervalMinutes: minutes.value,
    enabled: enabled.value,
    options: mergeOptions(props.schedule?.options, { dialogs: chats.value, messages: perChat.value })
  })
}
</script>

<template>
  <ScheduleFormShell
    v-model:interval="interval"
    v-model:enabled="enabled"
    :saving="saving"
    :error="error"
    :submit-label="schedule ? 'Сохранить' : 'Создать расписание'"
    @submit="submit"
    @cancel="emit('cancel')"
  >
    <div class="space-y-2">
      <Label for="telegram-account">Аккаунт Telegram</Label>
      <Select
        v-if="accounts.length > 0"
        :model-value="account"
        @update:model-value="(value) => (account = String(value))"
      >
        <SelectTrigger id="telegram-account"><SelectValue placeholder="Выберите аккаунт" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="item in accounts" :key="item.id" :value="item.id">{{ item.label }}</SelectItem>
        </SelectContent>
      </Select>
      <p v-else class="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning">
        Аккаунтов Telegram пока нет. <a href="/telegram" class="underline underline-offset-4">Подключите аккаунт</a>, затем вернитесь сюда.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="telegram-dialogs">Диалогов за запуск</Label>
        <Input id="telegram-dialogs" v-model="dialogs" type="number" inputmode="numeric" min="1" max="100" placeholder="100" class="tabular-nums" :disabled="saving" />
      </div>
      <div class="space-y-2">
        <Label for="telegram-messages">Сообщений на диалог</Label>
        <Input id="telegram-messages" v-model="messages" type="number" inputmode="numeric" min="1" max="200" placeholder="50" class="tabular-nums" :disabled="saving" />
      </div>
    </div>
  </ScheduleFormShell>
</template>
