<script setup lang="ts">
import { ref } from "vue"
import type { CrawlSchedule } from "@otbor/contract"
import { parseInterval, scheduleKindName, type ScheduleUpsertInput } from "@/entities/schedule"
import ScheduleFormShell from "./ScheduleFormShell.vue"

/** Для видов, которые создаются на своих страницах: правится только частота и «включено». */
const props = defineProps<{ schedule: CrawlSchedule; saving: boolean }>()
const emit = defineEmits<{ submit: [input: ScheduleUpsertInput]; cancel: [] }>()

const interval = ref(String(props.schedule.intervalMinutes))
const enabled = ref(props.schedule.enabled)
const error = ref<string | null>(null)

const submit = () => {
  const minutes = parseInterval(interval.value)
  if (!minutes.ok) return void (error.value = minutes.error)
  error.value = null
  emit("submit", {
    id: props.schedule.id,
    kind: props.schedule.kind,
    targetId: props.schedule.targetId,
    intervalMinutes: minutes.value,
    enabled: enabled.value,
    options: props.schedule.options
  })
}
</script>

<template>
  <ScheduleFormShell
    v-model:interval="interval"
    v-model:enabled="enabled"
    :saving="saving"
    :error="error"
    submit-label="Сохранить"
    :enabled-label="`${scheduleKindName(schedule.kind)} включено`"
    @submit="submit"
    @cancel="emit('cancel')"
  />
</template>
