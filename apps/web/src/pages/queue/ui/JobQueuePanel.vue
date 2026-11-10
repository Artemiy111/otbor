<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { refDebounced } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { QueueJob } from "@otbor/contract"
import type { ColumnDef, PaginationState } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { healthApi, healthKeys } from "@/entities/health"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { queueStageOptions, queueStatusOptions, valueList } from "@/features/queue-filter"
import {
  applicationPath,
  cn,
  describeError,
  formatAge,
  formatDate,
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
  filterableHeader
} from "@/shared/ui"
import { ExecutorStartGuide } from "@/widgets/executor-start"
import { StatCard } from "@/widgets/stat-card"
import { jobDetail, jobError, jobRawError, jobTiming, jobTitle } from "../model/job-view"

const PAGE_SIZE = 50

const props = defineProps<{
  kind: "browser" | "inference"
  /** Фильтр из адреса страницы: любые из этих статусов и стадий. */
  status: ReadonlyArray<string>
  stage: ReadonlyArray<string>
}>()
const emit = defineEmits<{ "update:filter": [value: { status?: ReadonlyArray<string>; stage?: ReadonlyArray<string> }] }>()

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

/** Значения выпадающих списков: группа статусов или одна стадия; «all», если ничего не выбрано. */
const statusValue = computed(() => (props.status.length === 0 ? "all" : props.status.join(",")))
const stageValue = computed(() => (props.stage.length === 0 ? "all" : props.stage.join(",")))
const stageOptions = computed(() => queueStageOptions(props.kind))

const pageSize = ref(PAGE_SIZE)
const pageIndex = ref(0)
const searchText = ref("")
const searchQuery = refDebounced(searchText, 300)
const onPagination = (state: PaginationState) => {
  pageSize.value = state.pageSize
  pageIndex.value = state.pageIndex
}
/** Смена состояния или задачи начинает с первой страницы: таблица пересоздаётся по ключу, а поиск сам сбрасывает страницу. */
const tableKey = computed(() => `${statusValue.value}|${stageValue.value}`)
watch([statusValue, stageValue], () => (pageIndex.value = 0))

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
  key: () =>
    queueJobKeys.search({
      kind: props.kind,
      status: statusValue.value,
      stage: stageValue.value,
      query: searchQuery.value.trim(),
      offset: pageIndex.value * pageSize.value,
      limit: pageSize.value
    }),
  query: () =>
    queueJobApi.search({
      kind: props.kind,
      status: props.status,
      stage: props.stage,
      query: searchQuery.value,
      limit: pageSize.value,
      offset: pageIndex.value * pageSize.value
    }),
  placeholderData: (previous) => previous
})

const stats = computed(() => statsQuery.data.value)
const jobs = computed<ReadonlyArray<QueueJob>>(() => jobsQuery.data.value?.items ?? [])
const total = computed(() => jobsQuery.data.value?.total ?? 0)
const shownRange = computed(() =>
  jobs.value.length === 0 ? "" : `${pageIndex.value * pageSize.value + 1}–${pageIndex.value * pageSize.value + jobs.value.length}`
)

const cards = computed(() => {
  const s = stats.value
  if (s === undefined) return []
  return [
    { label: "Ожидают", value: s.pending },
    { label: "В работе", value: s.leased + s.running },
    { label: "Готовы за сутки", value: s.done },
    { label: "Ошибки за сутки", value: s.failed + s.dead },
    ...(props.kind === "browser"
      ? [{ label: "Нужен человек или проверка (всего)", value: s.needsHuman + s.needsReconcile }]
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

/** Всё сырое: код этапа и статуса, аренда, ошибка как есть, JSON задания и результата. */
const detailsCell = (job: QueueJob) =>
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
      jobRawError(job) === null ? null : jsonBlock("Ошибка как есть", jobRawError(job)),
      jsonBlock("Задание (payload)", job.payload),
      job.result === null || job.result === undefined ? null : jsonBlock("Результат (result)", job.result)
    ])
  ])

const columns = computed<ColumnDef<QueueJob>[]>(() => [
  {
    id: "task",
    enableSorting: false,
    header: filterableHeader<QueueJob>("Задача", {
      value: () => stageValue.value,
      options: () => stageOptions.value,
      onChange: (value) => emit("update:filter", { stage: valueList(value) })
    }),
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
    header: "Аккаунт",
    cell: ({ row }) => {
      const accountId = row.original.hhAccountId
      if (accountId === null) return dash()
      // Список аккаунтов даёт цвет и подпись; если его нет, остаётся имя с сервера.
      return accounts.value.some((account) => account.id === accountId)
        ? h(AccountChip, { accountId, accounts: accounts.value, showName: true })
        : h("span", { class: "text-sm" }, row.original.accountName ?? "—")
    }
  },
  {
    id: "subject",
    enableSorting: false,
    header: "Вакансия и отклик",
    cell: ({ row }) => {
      const job = row.original
      if (job.vacancyId === null && job.applicationId === null) return dash()
      return h("div", { class: "max-w-72 text-sm" }, [
        job.vacancyId === null
          ? null
          : link(vacancyPath(job.vacancyId), job.vacancyTitle ?? "Вакансия"),
        job.applicationId === null ? null : link(applicationPath(job.applicationId), "Отклик")
      ])
    }
  },
  {
    id: "status",
    enableSorting: false,
    header: filterableHeader<QueueJob>("Состояние", {
      value: () => statusValue.value,
      options: () => queueStatusOptions,
      onChange: (value) => emit("update:filter", { status: valueList(value) })
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
    enableSorting: false,
    header: "Время",
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
      :key="tableKey"
      :columns="columns"
      :data="jobs"
      :is-loading="jobsQuery.isPending.value"
      :loading-row-count="6"
      :row-numbers="false"
      server-side
      filter
      filter-label="Поиск"
      filter-placeholder="Вакансия, аккаунт или текст ошибки"
      :page-size="pageSize"
      :page-size-options="[25, 50, 100]"
      :row-count="total"
      empty-title="Заданий нет"
      :empty-description="status.length > 0 || stage.length > 0 || searchQuery.trim() !== '' ? 'Измените фильтры или поиск.' : copy.empty"
      @update:pagination="onPagination"
      @update:globalFilter="(value: string) => (searchText = value)"
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground tabular-nums">
          <template v-if="total > 0">Показаны {{ shownRange }} из {{ total }}, новые сверху</template>
          <template v-else>Всего: 0</template>
        </span>
      </template>
    </DataTable>
  </div>
</template>
