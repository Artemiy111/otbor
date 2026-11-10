<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { formatDate, formatDuration, describeError } from "@/shared/lib"
import { Badge, Skeleton } from "@/shared/ui"
import { humanScheduleError } from "@/entities/schedule"
import { runResultText, scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"

/** Последние запуски одного расписания: когда, чем кончилось и что сделано. */
const props = withDefaults(defineProps<{ scheduleId: string; limit?: number }>(), { limit: 10 })

const query = useQuery({
  key: () => scheduleRunKeys.list(props.scheduleId, "panel"),
  query: () => scheduleRunApi.list({ scheduleId: props.scheduleId, limit: props.limit }),
  // Раскрытая история живёт рядом с опросом страницы: не старше полминуты.
  staleTime: 15_000
})

const items = computed(() => query.data.value?.items ?? [])
const failure = computed(() => (query.error.value ? describeError(query.error.value) : null))

const duration = (start: string, end: string | null | undefined): string => {
  if (end === null || end === undefined) return ""
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000
  return Number.isFinite(seconds) && seconds >= 0 ? formatDuration(Math.max(1, seconds)) : ""
}
</script>

<template>
  <div class="space-y-2" aria-live="polite">
    <p class="text-xs font-medium text-muted-foreground">Последние запуски</p>
    <div v-if="query.isPending.value" class="space-y-2">
      <Skeleton class="h-8 w-full" />
      <Skeleton class="h-8 w-full" />
    </div>
    <p v-else-if="failure" class="text-sm text-danger">Не удалось прочитать запуски: {{ failure }}</p>
    <p v-else-if="items.length === 0" class="text-sm text-muted-foreground">Запусков пока не было.</p>
    <ul v-else class="divide-y divide-border rounded-md border bg-card">
      <li
        v-for="run in items"
        :key="run.id"
        class="grid gap-x-4 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[9rem_6.5rem_minmax(0,1fr)_5rem] sm:items-baseline"
      >
        <span class="tabular-nums text-muted-foreground">{{ formatDate(run.startedAt) }}</span>
        <span>
          <Badge :variant="run.status === 'error' ? 'danger' : run.status === 'done' ? 'success' : 'info'">
            {{ run.status === "error" ? "Ошибка" : run.status === "done" ? "Готово" : "Выполняется" }}
          </Badge>
        </span>
        <span class="min-w-0">
          <template v-if="run.error">
            <span class="text-danger" :title="run.error">{{ humanScheduleError(run.error) }}</span>
          </template>
          <span v-else class="text-muted-foreground">{{ runResultText(run.kind, run.detail) || "—" }}</span>
        </span>
        <span class="tabular-nums text-xs text-muted-foreground sm:text-right">
          {{ duration(run.startedAt, run.finishedAt) }}
        </span>
      </li>
    </ul>
  </div>
</template>
