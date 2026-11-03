<script setup lang="ts">
import { computed, h, onUnmounted, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { CrawlRun, CrawlSchedule } from "@otbor/contract"
import { formatSearchUrl } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { crawlRunApi, crawlRunKeys } from "@/entities/crawl-run"
import { scheduleApi, scheduleKeys, type ScheduleUpsertInput } from "@/entities/schedule"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Input,
  Label,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => scheduleKeys.list(),
  query: () => scheduleApi.list()
})

const schedules = computed<ReadonlyArray<CrawlSchedule>>(() =>
  (query.data.value ?? []).filter((schedule) => schedule.kind === "search")
)

const runsQuery = useQuery({
  key: () => crawlRunKeys.list(),
  query: () => crawlRunApi.list({ limit: 50 })
})
const runs = computed<ReadonlyArray<CrawlRun>>(() =>
  (runsQuery.data.value as { items?: ReadonlyArray<CrawlRun> } | undefined)?.items ?? []
)
const runsPending = computed(() => (runsQuery as { isPending?: { value: boolean } }).isPending?.value ?? false)
const runsLoading = computed(() => (runsQuery as { isLoading?: { value: boolean } }).isLoading?.value ?? false)
const refreshRuns = () => (runsQuery as { refetch?: () => void }).refetch?.()
const runningRuns = computed(() => runs.value.filter((run) => run.status === "running"))
const hasRunningRuns = computed(() => runningRuns.value.length > 0)
const crawlStatusLabel = (status: CrawlRun["status"]): string => {
  switch (status) {
    case "running": return "Идёт поиск"
    case "done": return "Завершён"
    case "stopped": return "Остановлен"
    case "error": return "Ошибка"
  }
}
const crawlStatusVariant = (status: CrawlRun["status"]): "info" | "success" | "warning" | "destructive" => {
  switch (status) {
    case "running": return "info"
    case "done": return "success"
    case "stopped": return "warning"
    case "error": return "destructive"
  }
}
const pagePosition = (run: CrawlRun): string => {
  const current = run.currentPage === null ? run.pagesDone : run.currentPage + 1
  return run.pagesTotal === null || run.pagesTotal === undefined
    ? `страница ${Math.max(1, current)}, всего неизвестно`
    : `страница ${Math.max(1, current)} из ${run.pagesTotal}`
}
const progressPercent = (run: CrawlRun): number | null => {
  if (run.pagesTotal === null || run.pagesTotal === undefined || run.pagesTotal <= 0) return null
  return Math.min(100, Math.max(0, Math.round((run.pagesDone / run.pagesTotal) * 100)))
}
const elapsedLabel = (startedAt: string): string => {
  const millis = Math.max(0, Date.now() - new Date(startedAt).getTime())
  const minutes = Math.floor(millis / 60_000)
  if (minutes >= 1) return `${minutes} мин`
  return `${Math.max(1, Math.floor(millis / 1_000))} сек`
}
const isStaleRun = (run: CrawlRun): boolean =>
  run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > 15 * 60_000

const refreshAll = () => {
  void query.refetch()
  refreshRuns()
}
const isRefreshing = computed(() => query.isLoading.value || runsLoading.value)

const queryCache = useQueryCache()

const upsertMutation = useMutation<CrawlSchedule, ScheduleUpsertInput>({
  mutation: (input) => scheduleApi.upsert(input)
})

const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => scheduleApi.remove(id)
})

const runNowMutation = useMutation<{ readonly accepted: boolean }, string>({
  mutation: (id) => scheduleApi.runNow(id)
})

const target = ref("")
const interval = ref("30")
const enabled = ref(true)

const formError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const confirmDeleteId = ref<string | null>(null)
const removingId = ref<string | null>(null)
const runningId = ref<string | null>(null)

const isSaving = computed(() => upsertMutation.isLoading.value)
const isListPending = computed(() => query.isPending.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)

/** One delayed refetch after "run now"; the crawl itself is detached. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const scheduleRefresh = () => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void query.refetch()
    refreshRuns()
  }, 1_500)
}

let runsPollTimer: ReturnType<typeof setInterval> | null = null

const stopRunsPolling = () => {
  if (runsPollTimer !== null) {
    clearInterval(runsPollTimer)
    runsPollTimer = null
  }
}

const startRunsPolling = () => {
  if (runsPollTimer !== null) return
  runsPollTimer = setInterval(() => refreshRuns(), 2_000)
}

watch(hasRunningRuns, (running) => {
  if (running) startRunsPolling()
  else stopRunsPolling()
}, { immediate: true })

onUnmounted(() => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
  stopRunsPolling()
})

const resetForm = () => {
  target.value = ""
  interval.value = "30"
  enabled.value = true
  formError.value = null
}

const submit = async () => {
  actionError.value = null
  notice.value = null

  const trimmedTarget = target.value.trim()
  if (trimmedTarget === "") {
    formError.value = "Введите URL поиска hh.ru."
    return
  }
  if (!/^https?:\/\//i.test(trimmedTarget)) {
    formError.value = "URL должен начинаться с http:// или https://."
    return
  }

  const minutes = Number(interval.value)
  if (!Number.isInteger(minutes) || minutes < 5) {
    formError.value = "Интервал должен быть целым числом не меньше 5 минут."
    return
  }

  formError.value = null
  try {
    await upsertMutation.mutateAsync({
      kind: "search",
      targetId: trimmedTarget,
      intervalMinutes: minutes,
      enabled: enabled.value
    })
    resetForm()
    noticeTone.value = "info"
    notice.value = "Поиск создан."
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const remove = async (schedule: CrawlSchedule) => {
  actionError.value = null
  notice.value = null
  removingId.value = schedule.id
  try {
    const result = await removeMutation.mutateAsync(schedule.id)
    confirmDeleteId.value = null
    noticeTone.value = result.deleted ? "info" : "warning"
    notice.value = result.deleted ? "Поиск удалён." : "Поиск не удалён: запись не найдена."
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    removingId.value = null
  }
}

const runNow = async (schedule: CrawlSchedule) => {
  actionError.value = null
  notice.value = null
  runningId.value = schedule.id
  try {
    const result = await runNowMutation.mutateAsync(schedule.id)
    noticeTone.value = result.accepted ? "info" : "warning"
    notice.value = result.accepted
      ? "Запуск принят: поиск идёт в фоне."
      : "Запуск не принят: поиск не поставлен в очередь."
    if (result.accepted) scheduleRefresh()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    runningId.value = null
  }
}

const columns: ColumnDef<CrawlSchedule>[] = [
  {
    id: "target",
    accessorFn: (row) => formatSearchUrl(row.targetId),
    header: sortableHeader<CrawlSchedule>("Цель"),
    cell: ({ row }) => {
      const schedule = row.original
      const target = formatSearchUrl(schedule.targetId)
      return h("div", { class: "max-w-[260px]" }, [
        h(
          "a",
          {
            href: target,
            target: "_blank",
            rel: "noreferrer",
            class: "break-all text-sm text-sky-300 underline-offset-4 hover:underline"
          },
          target
        ),
        h("code", { class: "block text-[11px] text-muted-foreground" }, schedule.id)
      ])
    }
  },
  {
    accessorKey: "intervalMinutes",
    header: sortableHeader<CrawlSchedule>("Интервал"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap tabular-nums" },
        `${row.original.intervalMinutes} мин`
      )
  },
  {
    id: "enabled",
    accessorFn: (row) => (row.enabled ? "включён" : "выключен"),
    header: sortableHeader<CrawlSchedule>("Состояние"),
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.enabled ? "success" : "neutral" },
        () => (row.original.enabled ? "Включён" : "Выключен")
      )
  },
  {
    accessorKey: "lastRunAt",
    header: sortableHeader<CrawlSchedule>("Последний запуск"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground" },
        formatDate(row.original.lastRunAt)
      )
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) => {
      const schedule = row.original
      if (confirmDeleteId.value === schedule.id) {
        return h("div", { class: "flex items-center gap-1.5" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Удалить?"),
          h(
            Button,
            {
              size: "sm",
              variant: "destructive",
              disabled: removingId.value === schedule.id,
              onClick: () => void remove(schedule)
            },
            () => (removingId.value === schedule.id ? "Удаляем…" : "Да")
          ),
          h(
            Button,
            { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = null) },
            () => "Отмена"
          )
        ])
      }
      return h("div", { class: "flex flex-wrap items-center gap-1.5" }, [
        h(
          Button,
          {
            size: "sm",
            variant: "secondary",
            disabled: runningId.value === schedule.id,
            onClick: () => void runNow(schedule)
          },
          () => (runningId.value === schedule.id ? "Запускаем…" : "Запустить")
        ),
        h(
          Button,
          { size: "sm", variant: "ghost", onClick: () => (confirmDeleteId.value = schedule.id) },
          () => "Удалить"
        )
      ])
    }
  }
]

const runColumns: ColumnDef<CrawlRun>[] = [
  {
    id: "url",
    accessorFn: (row) => formatSearchUrl(row.normalizedUrl),
    header: sortableHeader<CrawlRun>("URL"),
    cell: ({ row }) =>
      h("span", {
        class: "block max-w-[280px] truncate text-xs",
        title: formatSearchUrl(row.original.normalizedUrl)
      }, formatSearchUrl(row.original.normalizedUrl))
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    header: sortableHeader<CrawlRun>("Статус"),
    cell: ({ row }) =>
      h(Badge, { variant: crawlStatusVariant(row.original.status) }, () =>
        crawlStatusLabel(row.original.status)
      )
  },
  {
    id: "progress",
    accessorFn: (row) => row.currentPage ?? row.pagesDone,
    header: sortableHeader<CrawlRun>("Прогресс"),
    cell: ({ row }) =>
      h("div", null, [
        h("div", { class: "whitespace-nowrap text-xs" }, pagePosition(row.original)),
        h(
          "div",
          { class: "text-[11px] text-muted-foreground" },
          `обработано: ${row.original.pagesDone}`
        )
      ])
  },
  {
    id: "result",
    accessorFn: (row) => row.found,
    header: sortableHeader<CrawlRun>("Итого"),
    cell: ({ row }) => {
      const run = row.original
      return h("div", {
        class: "whitespace-nowrap text-xs leading-5",
        title: `Найдено: ${run.found}\nДобавлено: ${run.inserted}\nОбновлено: ${run.updated}\nПропущено: ${run.skipped}`
      }, [
        h("div", { class: "tabular-nums font-medium" }, `найдено: ${run.found}`),
        h("div", { class: "tabular-nums text-muted-foreground" }, `+${run.inserted} нов. · ${run.updated} обн.`),
        h("div", { class: "tabular-nums text-muted-foreground" }, `${run.skipped} пропущено`)
      ])
    }
  },
  {
    id: "startedAt",
    accessorFn: (row) => row.startedAt,
    header: sortableHeader<CrawlRun>("Запущен"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.startedAt))
  },
  {
    id: "error",
    accessorFn: (row) => row.error ?? "",
    header: sortableHeader<CrawlRun>("Ошибка"),
    cell: ({ row }) =>
      row.original.error
        ? h("span", {
            class: "block max-w-[220px] truncate text-xs text-destructive",
            title: row.original.error
          }, row.original.error)
        : h("span", { class: "text-muted-foreground" }, "—")
  }
]
</script>

<template>
  <section>
    <PageHeader
      title="Поиск"
      description="Поиск новых вакансий на hh.ru: расписание обходит все страницы выдачи по указанному URL и сохраняет найденные вакансии в корпус."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refreshAll" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить расписания</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось выполнить действие</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" :variant="noticeTone" class="mb-4">
      <CircleAlert />
      <AlertTitle>{{ noticeTone === "warning" ? "Обратите внимание" : "Готово" }}</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Card v-if="hasRunningRuns" class="mb-4 border-sky-500/30">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Идёт поиск</CardTitle>
            <CardDescription>
              Статус обновляется автоматически каждые 2 секунды.
            </CardDescription>
          </div>
          <Badge variant="info">{{ runningRuns.length }} активно</Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div
          v-for="run in runningRuns"
          :key="run.runId"
          class="space-y-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <a
                :href="formatSearchUrl(run.normalizedUrl)"
                target="_blank"
                rel="noreferrer"
                class="break-all text-sm font-medium text-sky-300 underline-offset-4 hover:underline"
              >
                {{ formatSearchUrl(run.normalizedUrl) }}
              </a>
              <p class="mt-1 text-xs text-muted-foreground">
                Запущен {{ formatDate(run.startedAt) }} · идёт {{ elapsedLabel(run.startedAt) }}
              </p>
            </div>
            <Badge variant="info">{{ crawlStatusLabel(run.status) }}</Badge>
          </div>

          <Alert v-if="isStaleRun(run)" variant="warning">
            <CircleAlert />
            <AlertTitle>Запуск давно не обновляется</AlertTitle>
            <AlertDescription>
              Если worker остановился, запуск может остаться в статусе «идёт поиск».
            </AlertDescription>
          </Alert>

          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-sm font-medium">{{ pagePosition(run) }}</p>
              <p class="text-xs text-muted-foreground">обработано страниц: {{ run.pagesDone }}</p>
            </div>
            <p class="text-xs tabular-nums text-muted-foreground">
              {{ progressPercent(run) === null ? "всего страниц неизвестно" : `${progressPercent(run)}%` }}
            </p>
          </div>

          <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-label="pagePosition(run)" :aria-valuenow="progressPercent(run) ?? undefined" aria-valuemin="0" aria-valuemax="100">
            <div
              class="h-full rounded-full bg-sky-400 transition-all duration-500"
              :class="{ 'w-1/3 animate-pulse': progressPercent(run) === null }"
              :style="progressPercent(run) === null ? undefined : { width: `${progressPercent(run)}%` }"
            />
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p class="text-xs text-muted-foreground">Найдено</p>
              <p class="font-semibold tabular-nums">{{ run.found }}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Добавлено</p>
              <p class="font-semibold tabular-nums">{{ run.inserted }}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Обновлено</p>
              <p class="font-semibold tabular-nums">{{ run.updated }}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Пропущено</p>
              <p class="font-semibold tabular-nums">{{ run.skipped }}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="mb-4">
      <CardHeader>
        <CardTitle>Новый поиск</CardTitle>
        <CardDescription>
          Вставьте ссылку на выдачу hh.ru. Расписание живёт дольше одного запуска и регулярно
          обходит все страницы выдачи, сохраняя вакансии в корпус.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="submit">
          <Alert v-if="formError" variant="destructive">
            <CircleAlert />
            <AlertTitle>Проверьте форму</AlertTitle>
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2 md:col-span-2">
              <Label for="search-target">URL поиска hh.ru</Label>
              <Input
                id="search-target"
                v-model="target"
                type="url"
                placeholder="https://hh.ru/search/vacancy?text=devops&area=1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">
                Ссылка на выдачу hh.ru, например https://hh.ru/search/vacancy?text=devops&area=1.
              </p>
            </div>

            <div class="space-y-2">
              <Label for="search-interval">Интервал, минуты</Label>
              <Input
                id="search-interval"
                v-model="interval"
                type="number"
                min="5"
                step="1"
                :disabled="isSaving"
              />
              <p class="text-xs text-muted-foreground">Не меньше 5 минут.</p>
            </div>

            <div class="flex items-end">
              <Label class="flex items-center gap-2 font-normal">
                <input
                  v-model="enabled"
                  type="checkbox"
                  class="size-4 rounded border-input accent-primary"
                  :disabled="isSaving"
                />
                Поиск включён
              </Label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :disabled="isSaving">
              Создать поиск
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <DataTable
      :columns="columns"
      :data="schedules"
      :is-loading="isListPending"
      :loading-row-count="6"
      filter
      filter-label="Поиск"
      filter-placeholder="URL, состояние или ошибка"
      empty-title="Поисков нет"
      empty-description="Вставьте ссылку на выдачу hh.ru в форму выше, чтобы worker регулярно обходил все страницы и собирал вакансии в корпус."
    >
      <template #toolbar>
        <span class="pb-2 text-xs text-muted-foreground">Поисков: {{ schedules.length }}</span>
      </template>
    </DataTable>

    <Card class="mt-6">
      <CardHeader>
        <CardTitle>История прогонов</CardTitle>
        <CardDescription>
          Результаты последних запусков поиска: страница и общий прогресс, сколько найдено, добавлено, обновлено и пропущено.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          :columns="runColumns"
          :data="runs"
          :is-loading="runsPending"
          :loading-row-count="6"
          filter
          filter-label="Поиск"
          filter-placeholder="URL, статус или ошибка"
          empty-title="Прогонов пока нет"
          empty-description="Запустите поиск кнопкой «Запустить», чтобы здесь появился результат."
        >
          <template #toolbar>
            <RefreshButton :loading="runsLoading" @refresh="refreshRuns" />
            <span class="pb-2 text-xs text-muted-foreground">Прогонов: {{ runs.length }}</span>
          </template>
        </DataTable>
      </CardContent>
    </Card>
  </section>
</template>