<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery } from "@pinia/colada"
import type { HarnessJob } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { healthApi, healthKeys } from "@/entities/health"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { queueStatusOptions } from "@/features/queue-filter"
import {
  applicationPath,
  cn,
  describeError,
  formatAge,
  formatDate,
  jobStageLabel,
  payloadText,
  statusLabel,
  toneClasses,
  vacancyPath
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
import { ExecutorStartGuide } from "@/widgets/executor-start"
import { StatCard } from "@/widgets/stat-card"
import { jobDetail, jobError, jobRefs, jobTiming, jobTitle } from "../model/job-view"

const props = defineProps<{ kind: "browser" | "inference" }>()

const COPY = {
  browser: {
    who: "Исполнитель браузера",
    what: "Работа на hh.ru под вашим аккаунтом: чтение формы отклика, подготовка, отправка и проверка результата, обновление входа.",
    empty: "Заданий для браузера нет. Они появятся, когда вы подготовите отклик или загрузите резюме."
  },
  inference: {
    who: "Исполнитель генерации",
    what: "Генерация текста: письма, ответы на вопросы работодателя, оценки вакансий. Сервер не вызывает модель сам, а ставит задание сюда.",
    empty: "Заданий на генерацию нет."
  }
} as const
const copy = computed(() => COPY[props.kind])

const status = ref("all")
/** В списке статусов без служебных кодов в скобках: код виден в технических деталях. */
const statusOptions = queueStatusOptions.map((option) => ({
  ...option,
  label: option.label.replace(/\s*\([a-z_]+\)$/, "")
}))

const healthQuery = useQuery({ key: healthKeys.current(), query: healthApi.get })
const executorOnline = computed(() =>
  (healthQuery.data.value?.harnesses ?? []).some((h) => h.online && h.kinds.includes(props.kind))
)

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const accounts = computed(() => accountsQuery.data.value ?? [])

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
      ? [{ label: "Нужен человек или проверка", value: s.needsHuman + s.needsReconcile }]
      : [])
  ]
})

const errorText = computed(() => {
  const failure = jobsQuery.error.value ?? statsQuery.error.value
  return failure === null ? null : describeError(failure)
})

const dash = () => h("span", { class: "text-muted-foreground" }, "—")

const link = (href: string, label: string) =>
  h(
    "a",
    {
      href,
      class: "block whitespace-nowrap text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded"
    },
    label
  )

const jsonBlock = (title: string, value: unknown) =>
  h("div", null, [
    h("div", { class: "mb-1 text-xs font-medium text-muted-foreground" }, title),
    h(
      "pre",
      { class: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-xs" },
      payloadText(value)
    )
  ])

/** Всё сырое: код этапа и статуса, аренда, JSON задания и результата. */
const detailsCell = (job: HarnessJob) =>
  h("details", { class: "min-w-36 max-w-md" }, [
    h(
      "summary",
      { class: "cursor-pointer text-xs text-muted-foreground select-none rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" },
      "Технические детали"
    ),
    h("div", { class: "mt-2 space-y-3" }, [
      h("dl", { class: "grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs" }, [
        h("dt", { class: "text-muted-foreground" }, "Номер"),
        h("dd", { class: "font-mono break-all" }, job.id),
        h("dt", { class: "text-muted-foreground" }, "Этап и статус"),
        h("dd", { class: "font-mono" }, `${job.stage} · ${job.status}`),
        h("dt", { class: "text-muted-foreground" }, "Попытки"),
        h("dd", { class: "tabular-nums" }, `${job.attempts} из ${job.maxAttempts}`),
        h("dt", { class: "text-muted-foreground" }, "Аренда"),
        h("dd", { class: "tabular-nums" }, job.leaseUntil ? `до ${formatDate(job.leaseUntil)}` : "нет"),
        h("dt", { class: "text-muted-foreground" }, "Запуск"),
        h("dd", { class: "tabular-nums" }, formatDate(job.runAt)),
        h("dt", { class: "text-muted-foreground" }, "Создано"),
        h("dd", { class: "tabular-nums" }, formatDate(job.createdAt))
      ]),
      jsonBlock("Задание (payload)", job.payload),
      job.result === null || job.result === undefined ? null : jsonBlock("Результат (result)", job.result)
    ])
  ])

const columns = computed<ColumnDef<HarnessJob>[]>(() => [
  {
    id: "task",
    accessorFn: (row) => `${jobTitle(row.stage)} ${jobStageLabel(row.stage)}`,
    header: sortableHeader<HarnessJob>("Задача"),
    cell: ({ row }) => {
      const detail = jobDetail(row.original)
      return h("div", { class: "min-w-40" }, [
        h("div", { class: "font-medium" }, jobTitle(row.original.stage)),
        detail === null ? null : h("div", { class: "text-xs text-muted-foreground" }, detail)
      ])
    }
  },
  {
    id: "account",
    enableSorting: false,
    accessorFn: (row) => accounts.value.find((account) => account.id === jobRefs(row).accountId)?.label ?? "",
    header: "Аккаунт",
    cell: ({ row }) => {
      const accountId = jobRefs(row.original).accountId
      return accountId === null
        ? dash()
        : h(AccountChip, { accountId, accounts: accounts.value, showName: true })
    }
  },
  {
    id: "subject",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Вакансия и отклик",
    cell: ({ row }) => {
      const refs = jobRefs(row.original)
      if (refs.vacancyId === null && refs.applicationId === null) return dash()
      return h("div", { class: "text-sm" }, [
        refs.applicationId === null ? null : link(applicationPath(refs.applicationId), "Отклик"),
        refs.vacancyId === null ? null : link(vacancyPath(refs.vacancyId), "Вакансия")
      ])
    }
  },
  {
    id: "status",
    accessorFn: (row) => statusLabel(row.status),
    header: filterableHeader<HarnessJob>("Состояние", {
      value: () => status.value,
      options: () => statusOptions,
      onChange: (value) => (status.value = value)
    }),
    cell: ({ row }) => {
      const job = row.original
      return h("div", { class: "space-y-1" }, [
        h(StatusBadge, { value: job.status }),
        job.attempts > 1
          ? h("div", { class: "text-xs text-muted-foreground tabular-nums" }, `попытка ${job.attempts} из ${job.maxAttempts}`)
          : null
      ])
    }
  },
  {
    id: "timing",
    accessorFn: (row) => row.runAt,
    enableGlobalFilter: false,
    header: sortableHeader<HarnessJob>("Время"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-sm whitespace-nowrap text-muted-foreground tabular-nums", title: formatDate(row.original.runAt) },
        jobTiming(row.original)
      )
  },
  {
    id: "error",
    enableSorting: false,
    accessorFn: (row) => jobError(row) ?? "",
    header: "Последняя ошибка",
    cell: ({ row }) => {
      const message = jobError(row.original)
      return message === null
        ? dash()
        : h("span", { class: cn("block max-w-64 text-sm", toneClasses("danger").text) }, message)
    }
  },
  {
    id: "details",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "",
    cell: ({ row }) => detailsCell(row.original)
  }
])

const refetch = () => Promise.all([statsQuery.refetch(), jobsQuery.refetch(), healthQuery.refetch()])
defineExpose({ refetch, loading: computed(() => statsQuery.isLoading.value || jobsQuery.isLoading.value) })
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-md border p-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">{{ copy.who }}</span>
        <StatusBadge :value="executorOnline ? 'ok' : 'down'" :label="executorOnline ? 'работает' : 'не запущен'" />
      </div>
      <p class="mt-1 text-muted-foreground">{{ copy.what }}</p>
      <div v-if="!executorOnline && !healthQuery.isPending.value" class="mt-3 border-t border-border pt-3">
        <p class="mb-2" :class="toneClasses('danger').text">Исполнитель не запущен, задания будут ждать.</p>
        <ExecutorStartGuide :target="kind" />
      </div>
    </div>

    <Alert v-if="errorText" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось прочитать очередь</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="stats" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" />
      <StatCard label="Дольше всех ждёт" :value="formatAge(stats.oldestPendingAgeSeconds)" />
    </div>

    <DataTable
      :columns="columns"
      :data="jobs"
      :is-loading="jobsQuery.isPending.value"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="Задача, аккаунт или состояние"
      empty-title="Заданий нет"
      :empty-description="copy.empty"
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground tabular-nums">
          Показаны последние {{ jobs.length }}{{ jobs.length >= 200 ? " (больше не выводится)" : "" }}
        </span>
      </template>
    </DataTable>
  </div>
</template>
