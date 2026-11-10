<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { CrawlSchedule } from "@otbor/contract"
import { mailAccountApi, mailAccountKeys } from "@/entities/mail-account"
import {
  mergeOptions,
  optionText,
  parseInterval,
  parseOptionalInt,
  type ScheduleUpsertInput
} from "@/entities/schedule"
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import ScheduleFormShell from "./ScheduleFormShell.vue"

const props = defineProps<{ schedule?: CrawlSchedule | null; saving: boolean }>()
const emit = defineEmits<{ submit: [input: ScheduleUpsertInput]; cancel: [] }>()

const accountsQuery = useQuery({ key: () => mailAccountKeys.list(), query: () => mailAccountApi.list() })
const accounts = computed(() => accountsQuery.data.value ?? [])

const account = ref(props.schedule?.targetId ?? "")
const interval = ref(String(props.schedule?.intervalMinutes ?? 60))
const enabled = ref(props.schedule?.enabled ?? true)
const days = ref(optionText(props.schedule?.options ?? {}, "days"))
const limit = ref(optionText(props.schedule?.options ?? {}, "limit"))
const pages = ref(optionText(props.schedule?.options ?? {}, "maxPages"))
const error = ref<string | null>(null)

const selected = computed(() => accounts.value.find((item) => item.id === account.value))

const submit = () => {
  if (account.value === "") return void (error.value = "Выберите почтовый ящик.")
  const minutes = parseInterval(interval.value)
  if (!minutes.ok) return void (error.value = minutes.error)
  const depth = parseOptionalInt(days.value, "За сколько дней", 0, 3_650)
  if (!depth.ok) return void (error.value = depth.error)
  const perPage = parseOptionalInt(limit.value, "Писем на страницу", 1, 500)
  if (!perPage.ok) return void (error.value = perPage.error)
  const maxPages = parseOptionalInt(pages.value, "Страниц за запуск", 1, 100)
  if (!maxPages.ok) return void (error.value = maxPages.error)
  error.value = null
  emit("submit", {
    ...(props.schedule ? { id: props.schedule.id } : {}),
    kind: "mail_sync",
    targetId: account.value,
    intervalMinutes: minutes.value,
    enabled: enabled.value,
    options: mergeOptions(props.schedule?.options, { days: depth.value, limit: perPage.value, maxPages: maxPages.value })
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
      <Label for="mail-account">Почтовый ящик</Label>
      <Select
        v-if="accounts.length > 0"
        :model-value="account"
        @update:model-value="(value) => (account = String(value))"
      >
        <SelectTrigger id="mail-account"><SelectValue placeholder="Выберите ящик" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="item in accounts" :key="item.id" :value="item.id">{{ item.label }}</SelectItem>
        </SelectContent>
      </Select>
      <p v-else class="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning">
        Почтовых ящиков пока нет. <a href="/mail" class="underline underline-offset-4">Добавьте ящик</a>, затем вернитесь сюда.
      </p>
      <p v-if="selected" class="text-xs text-muted-foreground">
        По умолчанию читается история за {{ selected.backfillDays }} дн. — это настройка самого ящика.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="space-y-2">
        <Label for="mail-days">За сколько дней</Label>
        <Input id="mail-days" v-model="days" type="number" inputmode="numeric" min="0" max="3650" :placeholder="selected ? String(selected.backfillDays) : '30'" class="tabular-nums" :disabled="saving" />
      </div>
      <div class="space-y-2">
        <Label for="mail-limit">Писем на страницу</Label>
        <Input id="mail-limit" v-model="limit" type="number" inputmode="numeric" min="1" max="500" placeholder="100" class="tabular-nums" :disabled="saving" />
      </div>
      <div class="space-y-2">
        <Label for="mail-pages">Страниц за запуск</Label>
        <Input id="mail-pages" v-model="pages" type="number" inputmode="numeric" min="1" max="100" placeholder="10" class="tabular-nums" :disabled="saving" />
      </div>
    </div>
  </ScheduleFormShell>
</template>
