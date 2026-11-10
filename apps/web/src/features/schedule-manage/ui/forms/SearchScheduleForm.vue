<script setup lang="ts">
import { ref } from "vue"
import type { CrawlSchedule } from "@otbor/contract"
import { parseInterval, parseSearchUrl, type ScheduleUpsertInput } from "@/entities/schedule"
import { Input, Label } from "@/shared/ui"
import ScheduleFormShell from "./ScheduleFormShell.vue"

const props = defineProps<{ schedule?: CrawlSchedule | null; saving: boolean }>()
const emit = defineEmits<{ submit: [input: ScheduleUpsertInput]; cancel: [] }>()

const url = ref(props.schedule?.targetId ?? "")
const interval = ref(String(props.schedule?.intervalMinutes ?? 30))
const enabled = ref(props.schedule?.enabled ?? true)
const error = ref<string | null>(null)

const submit = () => {
  const target = parseSearchUrl(url.value)
  if (!target.ok) return void (error.value = target.error)
  const minutes = parseInterval(interval.value)
  if (!minutes.ok) return void (error.value = minutes.error)
  error.value = null
  emit("submit", {
    ...(props.schedule ? { id: props.schedule.id } : {}),
    kind: props.schedule?.kind ?? "search",
    targetId: target.value,
    intervalMinutes: minutes.value,
    enabled: enabled.value,
    ...(props.schedule ? { options: props.schedule.options } : {})
  })
}
</script>

<template>
  <ScheduleFormShell
    v-model:interval="interval"
    v-model:enabled="enabled"
    :saving="saving"
    :error="error"
    :submit-label="schedule ? 'Сохранить' : 'Создать поиск'"
    enabled-label="Поиск включён"
    @submit="submit"
    @cancel="emit('cancel')"
  >
    <div class="space-y-2">
      <Label for="search-target">Ссылка на поиск hh.ru</Label>
      <Input
        id="search-target"
        v-model="url"
        type="url"
        placeholder="https://hh.ru/search/vacancy?text=devops&area=1"
        :disabled="saving"
      />
      <p class="text-xs text-muted-foreground">
        Откройте поиск на hh.ru, настройте фильтры и скопируйте адрес страницы. Обходятся все страницы выдачи,
        новые вакансии сохраняются.
      </p>
    </div>
  </ScheduleFormShell>
</template>
