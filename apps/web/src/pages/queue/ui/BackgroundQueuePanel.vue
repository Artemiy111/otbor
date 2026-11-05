<script setup lang="ts">
import { computed, h } from "vue"
import { useQuery } from "@pinia/colada"
import type { ScheduleRun } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"
import { describeError, formatDate, scheduleKindLabel } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Badge, DataTable, StatusBadge, sortableHeader } from "@/shared/ui"

const runsQuery = useQuery({
  key: () => scheduleRunKeys.list(undefined, "all-recent"),
  query: () => scheduleRunApi.list({ limit: 200 })
})
const runs = computed<ReadonlyArray<ScheduleRun>>(() => runsQuery.data.value?.items ?? [])

/** A short human line from the run's detail: progress while running, totals after. */
const detailLine = (run: ScheduleRun): string => {
  const d = (run.detail ?? {}) as Record<string, unknown>
  const num = (key: string): number | null => (typeof d[key] === "number" ? (d[key] as number) : null)
  const processed = num("processed")
  const target = num("target")
  const parts: string[] = []
  if (processed !== null && target !== null) parts.push(`${processed} из ${target}`)
  else if (processed !== null) parts.push(`обработано ${processed}`)
  const pages = num("pagesDone")
  if (pages !== null) parts.push(`страниц ${pages}`)
  const found = num("found")
  if (found !== null) parts.push(`найдено ${found}`)
  const inserted = num("inserted")
  if (inserted) parts.push(`новых ${inserted}`)
  const updated = num("updated")
  if (updated) parts.push(`обновлено ${updated}`)
  const failed = num("failed")
  if (failed) parts.push(`ошибок ${failed}`)
  return parts.join(", ")
}

/** One lane per kind: what runs now, or how the last run ended. */
const lanes = computed(() => {
  const byKind = new Map<string, ScheduleRun>()
  for (const run of runs.value) {
    const seen = byKind.get(run.kind)
    // Runs arrive newest first; a running run beats an older finished one.
    if (seen === undefined || (run.status === "running" && seen.status !== "running")) byKind.set(run.kind, run)
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind))
})
const runningCount = computed(() => runs.value.filter((r) => r.status === "running").length)

const columns: ColumnDef<ScheduleRun>[] = [
  {
    id: "kind",
    accessorFn: (row) => scheduleKindLabel(row.kind),
    header: sortableHeader<ScheduleRun>("Вид"),
    cell: ({ row }) => h("span", null, scheduleKindLabel(row.original.kind))
  },
  {
    accessorKey: "status",
    header: sortableHeader<ScheduleRun>("Статус"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.status, raw: true })
  },
  {
    accessorKey: "startedAt",
    header: sortableHeader<ScheduleRun>("Начат"),
    cell: ({ row }) => h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.startedAt))
  },
  {
    id: "finished",
    accessorFn: (row) => row.finishedAt ?? "",
    header: sortableHeader<ScheduleRun>("Закончен"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, row.original.finishedAt ? formatDate(row.original.finishedAt) : "—")
  },
  {
    id: "result",
    enableSorting: false,
    header: "Итог",
    cell: ({ row }) =>
      h("div", { class: "max-w-[420px] text-sm" }, [
        h("span", null, detailLine(row.original) || "—"),
        row.original.error ? h("div", { class: "text-destructive" }, row.original.error) : null
      ])
  }
]

const errorText = computed(() => (runsQuery.error.value ? describeError(runsQuery.error.value) : null))
const refetch = () => runsQuery.refetch()
defineExpose({ refetch, loading: computed(() => runsQuery.isLoading.value) })
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-md border p-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">Исполнитель: worker облака, по расписанию</span>
        <Badge variant="secondary">{{ runningCount }} идёт сейчас</Badge>
      </div>
      <p class="mt-1 text-muted-foreground">
        Обходы hh, гидрация вакансий и компаний, анализ, синхронизации почты, Telegram и резюме. Это не очередь заданий:
        запуски создаются по расписанию (страница «Расписания»). По каждому виду идёт один запуск, разные виды работают
        параллельно. Запуск без сигнала жизни 3 минуты считается оборванным.
      </p>
    </div>

    <Alert v-if="errorText" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось прочитать запуски</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="lane in lanes" :key="lane.kind" class="rounded-md border p-3 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ scheduleKindLabel(lane.kind) }}</span>
          <StatusBadge :value="lane.status" raw />
        </div>
        <div class="mt-1 text-muted-foreground">
          {{ lane.status === "running" ? "идёт с" : "последний запуск" }} {{ formatDate(lane.startedAt) }}
        </div>
        <div v-if="detailLine(lane)" class="mt-1">{{ detailLine(lane) }}</div>
        <div v-if="lane.error" class="mt-1 text-destructive">{{ lane.error }}</div>
      </div>
    </div>

    <h3 class="text-sm font-semibold">История запусков</h3>
    <DataTable
      :columns="columns"
      :data="runs"
      :is-loading="runsQuery.isPending.value"
      :loading-row-count="6"
      empty-title="Запусков нет"
      empty-description="Запуски появятся, когда сработает первое расписание."
    />
  </div>
</template>
