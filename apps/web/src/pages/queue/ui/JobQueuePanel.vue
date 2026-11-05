<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { HarnessJob } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { healthApi, healthKeys } from "@/entities/health"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { queueStatusOptions } from "@/features/queue-filter"
import {
  describeError,
  formatAge,
  formatDate,
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
  StatusBadge,
  filterableHeader,
  sortableHeader
} from "@/shared/ui"
import { StatCard } from "@/widgets/stat-card"

const props = defineProps<{ kind: "browser" | "inference" }>()

const COPY = {
  browser: {
    who: "Браузерный harness",
    command: "otbor harness run",
    what: "Работа на hh.ru под вашим аккаунтом: чтение формы отклика, подготовка, отправка и сверка результата, обновление сессии.",
    empty: "Заданий для браузера нет. Они появятся, когда вы подготовите отклик или загрузите резюме."
  },
  inference: {
    who: "Harness с ACP-агентом (opencode или claude)",
    command: "otbor harness run",
    what: "Генерация текста: письма, ответы на анкеты, оценки вакансий. Облако не вызывает модель само, а ставит задание сюда.",
    empty: "Заданий на генерацию нет."
  }
} as const
const copy = computed(() => COPY[props.kind])

const status = ref("all")

const healthQuery = useQuery({ key: healthKeys.current(), query: healthApi.get })
const executorOnline = computed(() =>
  (healthQuery.data.value?.harnesses ?? []).some((h) => h.online && h.kinds.includes(props.kind))
)

const statsQuery = useQuery({
  key: () => queueJobKeys.stats(props.kind),
  query: () => queueJobApi.stats(props.kind)
})
const jobsQuery = useQuery({
  key: () => queueJobKeys.list(status.value, props.kind),
  query: () =>
    queueJobApi.list({
      kind: props.kind,
      limit: 200,
      status: status.value === "all" ? undefined : status.value
    })
})

const stats = computed(() => statsQuery.data.value)
const jobs = computed<ReadonlyArray<HarnessJob>>(() => jobsQuery.data.value ?? [])

const cards = computed(() => {
  const s = stats.value
  if (s === undefined) return []
  return [
    { label: "Ожидают", value: s.pending },
    { label: "В работе", value: s.leased + s.running },
    { label: "Готовы за сутки", value: s.done },
    { label: "Ошибки", value: s.failed + s.dead },
    ...(props.kind === "browser"
      ? [{ label: "Нужен человек или сверка", value: s.needsHuman + s.needsReconcile }]
      : [])
  ]
})

const errorText = computed(() => {
  const failure = jobsQuery.error.value ?? statsQuery.error.value
  return failure === null ? null : describeError(failure)
})

const payloadCell = (value: unknown) =>
  h("div", { class: "max-w-[320px]" }, [
    h("details", null, [
      h("summary", { class: "cursor-pointer font-mono text-xs text-muted-foreground" }, payloadPreview(value)),
      h(
        "pre",
        { class: "mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]" },
        payloadText(value)
      )
    ])
  ])

const columns = computed<ColumnDef<HarnessJob>[]>(() => [
  ...(props.kind === "browser"
    ? [{
        id: "stage",
        accessorFn: (row: HarnessJob) => jobStageLabel(row.stage),
        header: sortableHeader<HarnessJob>("Этап"),
        cell: ({ row }: { row: { original: HarnessJob } }) => h("span", null, jobStageLabel(row.original.stage))
      } satisfies ColumnDef<HarnessJob>]
    : []),
  {
    id: "status",
    accessorFn: (row) => statusLabel(row.status),
    header: filterableHeader<HarnessJob>("Статус", {
      value: () => status.value,
      options: () => queueStatusOptions,
      onChange: (value) => (status.value = value)
    }),
    cell: ({ row }) => h(StatusBadge, { value: row.original.status, raw: true })
  },
  {
    accessorKey: "attempts",
    header: sortableHeader<HarnessJob>("Попытки"),
    cell: ({ row }) => h("span", { class: "tabular-nums" }, `${row.original.attempts} / ${row.original.maxAttempts}`)
  },
  {
    id: "lease",
    accessorFn: (row) => row.leaseUntil ?? "",
    enableGlobalFilter: false,
    header: sortableHeader<HarnessJob>("Аренда"),
    cell: ({ row }) => {
      const job = row.original
      if (!job.leaseUntil) return h("span", { class: "text-muted-foreground" }, "—")
      return h("span", { class: "text-muted-foreground" }, `до ${formatDate(job.leaseUntil)}`)
    }
  },
  {
    accessorKey: "runAt",
    header: sortableHeader<HarnessJob>("Запуск"),
    cell: ({ row }) => h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.runAt))
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
      return result === null || result === undefined
        ? h("span", { class: "text-muted-foreground" }, "—")
        : payloadCell(result)
    }
  }
])

const refetch = () => Promise.all([statsQuery.refetch(), jobsQuery.refetch(), healthQuery.refetch()])
defineExpose({ refetch, loading: computed(() => statsQuery.isLoading.value || jobsQuery.isLoading.value) })
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-md border p-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">Исполнитель: {{ copy.who }}</span>
        <StatusBadge :value="executorOnline ? 'ok' : 'down'" raw />
      </div>
      <p class="mt-1 text-muted-foreground">{{ copy.what }}</p>
      <p v-if="!executorOnline" class="mt-1 text-destructive">
        Исполнитель не запущен, задания будут ждать. Запуск: <code>{{ copy.command }}</code>
      </p>
    </div>

    <Alert v-if="errorText" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось прочитать очередь</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="stats" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" />
      <StatCard label="Старейшее ожидание" :value="formatAge(stats.oldestPendingAgeSeconds)" />
    </div>

    <DataTable
      :columns="columns"
      :data="jobs"
      :is-loading="jobsQuery.isPending.value"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="Этап или статус"
      empty-title="Заданий нет"
      :empty-description="copy.empty"
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Заданий: {{ jobs.length }}</span>
      </template>
    </DataTable>
  </div>
</template>
