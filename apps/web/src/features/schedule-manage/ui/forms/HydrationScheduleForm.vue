<script setup lang="ts">
import { ref } from "vue"
import type { CrawlSchedule, ProxyMode } from "@otbor/contract"
import {
  mergeOptions,
  optionText,
  parseInterval,
  parseOptionalInt,
  type ScheduleUpsertInput
} from "@/entities/schedule"
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"
import ScheduleFormShell from "./ScheduleFormShell.vue"

const props = defineProps<{
  kind: "vacancy_hydration" | "employer_hydration"
  schedule?: CrawlSchedule | null
  saving: boolean
}>()
const emit = defineEmits<{ submit: [input: ScheduleUpsertInput]; cancel: [] }>()

const isVacancy = props.kind === "vacancy_hydration"
const defaultDelay = isVacancy ? "1000" : "750"

const proxyOf = (value: unknown): ProxyMode => (value === "direct" || value === "proxy" ? value : "auto")

const interval = ref(String(props.schedule?.intervalMinutes ?? 30))
const enabled = ref(props.schedule?.enabled ?? true)
const limit = ref(optionText(props.schedule?.options ?? {}, "limit") || "25")
const delay = ref(optionText(props.schedule?.options ?? {}, "delayMs") || defaultDelay)
const proxy = ref<ProxyMode>(proxyOf(props.schedule?.options.proxyMode))
const error = ref<string | null>(null)

const submit = () => {
  const minutes = parseInterval(interval.value)
  if (!minutes.ok) return void (error.value = minutes.error)
  const count = parseOptionalInt(limit.value, "За один запуск", 1, 200)
  if (!count.ok) return void (error.value = count.error)
  const pause = parseOptionalInt(delay.value, "Пауза между запросами", 0, 60_000)
  if (!pause.ok) return void (error.value = pause.error)
  error.value = null
  emit("submit", {
    ...(props.schedule ? { id: props.schedule.id } : {}),
    kind: props.kind,
    targetId: props.schedule?.targetId ?? "global",
    intervalMinutes: minutes.value,
    enabled: enabled.value,
    options: mergeOptions(props.schedule?.options, { limit: count.value, delayMs: pause.value, proxyMode: proxy.value })
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
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="space-y-2">
        <Label for="hydration-limit">{{ isVacancy ? "Вакансий за запуск" : "Компаний за запуск" }}</Label>
        <Input id="hydration-limit" v-model="limit" type="number" inputmode="numeric" min="1" max="200" class="tabular-nums" :disabled="saving" />
      </div>
      <div class="space-y-2">
        <Label for="hydration-delay">Пауза, мс</Label>
        <Input id="hydration-delay" v-model="delay" type="number" inputmode="numeric" min="0" max="60000" class="tabular-nums" :disabled="saving" />
      </div>
      <div class="space-y-2">
        <Label for="hydration-proxy">Через прокси</Label>
        <Select :model-value="proxy" @update:model-value="(value) => (proxy = proxyOf(value))">
          <SelectTrigger id="hydration-proxy"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Если настроен</SelectItem>
            <SelectItem value="direct">Напрямую</SelectItem>
            <SelectItem value="proxy">Только через прокси</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  </ScheduleFormShell>
</template>
