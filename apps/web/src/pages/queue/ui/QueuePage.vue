<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { HarnessJob } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { QueueStatusFilter } from "@/features/queue-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatAge,
  formatDate,
  jobKindLabel,
  jobStageLabel,
  payloadPreview,
  payloadText,
  statusLabel
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  DataTable,
  Skeleton,
  StatusBadge,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const status = ref("all")

const statsQuery = useQuery({
  key: queueJobKeys.stats(),
  query: queueJobApi.stats
})

const jobsQuery = useQuery({
  key: () => queueJobKeys.list(status.value),
  query: () =>
    queueJobApi.list({
      limit: 200,
      status: status.value === "all" ? undefined : status.value
    })
})

const stats = computed(() => statsQuery.data.value)
const jobs = computed<ReadonlyArray<HarnessJob>>(() => jobsQuery.data.value ?? [])

const cards = computed(() => {
  const value = stats.value
  if (value === undefined) return []
  return [
    { label: "Ожидают", value: value.pending },
    { label: "Взяты", value: value.leased },
    { label: "Выполняются", value: value.running },
    { label: "Готовы", value: value.done },
    { label: "С ошибкой", value: value.failed },
    { label: "Исчерпаны", value: value.dead },
    { label: "Нужен человек", value: value.needsHuman },
    { label: "Нужна сверка", value: value.needsReconcile }
  ]
})

const errorText = computed(() => {
  const failure = jobsQuery.error.value ?? statsQuery.error.value
  return failure === null ? null : describeError(failure)
})

const isRefreshing = computed(
  () => statsQuery.isLoading.value || jobsQuery.isLoading.value
)

const payloadCell = (value: unknown) =>
  h("div", { class: "max-w-[320px]" }, [
    h("details", null, [
      h(
        "summary",
        { class: "cursor-pointer font-mono text-xs text-muted-foreground" },
        payloadPreview(value)
      ),
      h(
        "pre",
        {
          class:
            "mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]"
        },
        payloadText(value)
      )
    ])
  ])

const columns: ColumnDef<HarnessJob>[] = [
  {
    id: "kind",
    accessorFn: (row) => jobKindLabel(row.kind),
    header: sortableHeader<HarnessJob>("Тип"),
    cell: ({ row }) => h("span", null, jobKindLabel(row.original.kind))
  },
  {
    id: "stage",
    accessorFn: (row) => jobStageLabel(row.stage),
    header: sortableHeader<HarnessJob>("Этап"),
    cell: ({ row }) => h("span", null, jobStageLabel(row.original.stage))
  },
  {
    id: "status",
    accessorFn: (row) => statusLabel(row.status),
    header: sortableHeader<HarnessJob>("Статус"),
    cell: ({ row }) => h(StatusBadge, { value: row.original.status, raw: true })
  },
  {
    accessorKey: "priority",
    header: sortableHeader<HarnessJob>("Приоритет"),
    cell: ({ row }) =>
      h("span", { class: "font-mono tabular-nums" }, String(row.original.priority))
  },
  {
    accessorKey: "attempts",
    header: sortableHeader<HarnessJob>("Попытки"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "tabular-nums" },
        `${row.original.attempts} / ${row.original.maxAttempts}`
      )
  },
  {
    id: "lease",
    accessorFn: (row) => row.leaseUntil ?? "",
    enableGlobalFilter: false,
    header: sortableHeader<HarnessJob>("Аренда"),
    cell: ({ row }) => {
      const job = row.original
      if (!job.leaseUntil) return h("span", { class: "text-muted-foreground" }, "—")
      return h("div", { class: "text-muted-foreground" }, [
        h("div", { class: "font-mono text-xs" }, job.leaseId ?? "—"),
        h("div", null, formatDate(job.leaseUntil))
      ])
    }
  },
  {
    accessorKey: "runAt",
    header: sortableHeader<HarnessJob>("Запуск"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.runAt)
      )
  },
  {
    id: "payload",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Задание",
    cell: ({ row }) => payloadCell(row.original.payload)
  },
  {
    id: "result",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Результат",
    cell: ({ row }) => {
      const result = row.original.result
      if (result === null || result === undefined) {
        return h("span", { class: "text-muted-foreground" }, "—")
      }
      return payloadCell(result)
    }
  }
]

const refresh = () => {
  void Promise.all([statsQuery.refetch(), jobsQuery.refetch()])
}
</script>

<template>
  <section>
    <PageHeader
      title="Очередь"
      description="Задания harness. Аренда эксклюзивна, а каждый итог облако сверяет само."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось прочитать очередь</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="statsQuery.isPending.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Skeleton v-for="index in 5" :key="index" class="h-24 w-full" />
    </div>
    <div v-else-if="stats" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" />
      <StatCard label="Старейшее ожидание" :value="formatAge(stats.oldestPendingAgeSeconds)" />
    </div>

    <div class="mt-4">
      <DataTable
        :columns="columns"
        :data="jobs"
        :is-loading="jobsQuery.isPending.value"
        :loading-row-count="8"
        filter
        filter-label="Поиск"
        filter-placeholder="Тип, этап или статус"
        empty-title="Заданий нет"
        empty-description="Новая работа браузера и генерации появится здесь после постановки в очередь."
      >
        <template #toolbar>
          <QueueStatusFilter v-model="status" />
          <span class="pb-2 text-xs text-muted-foreground">Заданий: {{ jobs.length }}</span>
        </template>
      </DataTable>
    </div>
  </section>
</template>
