<script setup lang="ts">
import { computed, h, ref } from "vue"
import type { CrawlRun, CrawlSchedule } from "@otbor/contract"
import { formatSearchUrl } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Plus } from "@lucide/vue"
import { crawlStatusLabel, crawlStatusVariant, CrawlProgress, pagePosition } from "@/entities/crawl-run"
import { groupSchedules, scheduleTarget } from "@/entities/schedule"
import { RefreshButton } from "@/features/refresh-button"
import { ScheduleFormDialog, ScheduleList, useScheduleActions, useSchedulesBoard } from "@/features/schedule-manage"
import { formatDate } from "@/shared/lib"
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
  EmptyState,
  Skeleton,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const SEARCH_KINDS = ["search", "source"] as const

const board = useSchedulesBoard(SEARCH_KINDS)
const actions = useScheduleActions()

const runningCrawls = computed(() => board.crawlRuns.value.filter((run) => run.status === "running"))
const sections = computed(() =>
  groupSchedules(board.schedules.value, (schedule) => scheduleTarget(schedule, board.lookup.value).text)
)

const dialogOpen = ref(false)
const editing = ref<CrawlSchedule | null>(null)
const openCreate = () => {
  editing.value = null
  dialogOpen.value = true
}
const openEdit = (schedule: CrawlSchedule) => {
  editing.value = schedule
  dialogOpen.value = true
}

const runColumns: ColumnDef<CrawlRun>[] = [
  {
    id: "url",
    accessorFn: (row) => formatSearchUrl(row.normalizedUrl),
    header: sortableHeader<CrawlRun>("Поиск"),
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
      h(Badge, { variant: crawlStatusVariant(row.original.status) }, () => crawlStatusLabel(row.original.status))
  },
  {
    id: "progress",
    accessorFn: (row) => row.currentPage ?? row.pagesDone,
    header: sortableHeader<CrawlRun>("Прогресс"),
    cell: ({ row }) =>
      h("div", null, [
        h("div", { class: "whitespace-nowrap text-xs" }, pagePosition(row.original)),
        h("div", { class: "text-xs text-muted-foreground" }, `обработано: ${row.original.pagesDone}`)
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
        title: `Найдено: ${run.found}\nНовых: ${run.inserted}\nОбновлено: ${run.updated}\nПропущено: ${run.skipped}`
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
            class: "block max-w-[220px] truncate text-xs text-danger",
            title: row.original.error
          }, "Поиск завершился ошибкой")
        : h("span", { class: "text-muted-foreground" }, "—")
  }
]
</script>

<template>
  <section class="space-y-6">
    <PageHeader
      title="Поиск вакансий"
      description="Сохранённые поиски hh.ru: расписание обходит все страницы выдачи по ссылке и сохраняет новые вакансии."
    >
      <template #actions>
        <RefreshButton :loading="board.isRefreshing.value" @refresh="board.refresh()" />
        <Button variant="outline" as-child>
          <a href="/schedules?group=search">Все расписания →</a>
        </Button>
        <Button @click="openCreate">
          <Plus />
          Новый поиск
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="board.error.value" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить поиски</AlertTitle>
      <AlertDescription>{{ board.error.value }}</AlertDescription>
    </Alert>

    <Card v-if="runningCrawls.length > 0" class="border-info/30">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Идёт поиск</CardTitle>
            <CardDescription>Ход обновляется сам, пока поиск не закончится.</CardDescription>
          </div>
          <Badge variant="info">{{ runningCrawls.length }} активно</Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <CrawlProgress v-for="run in runningCrawls" :key="run.runId" :run="run" :now="board.now.value">
          <template #title>
            <a
              :href="formatSearchUrl(run.normalizedUrl)"
              target="_blank"
              rel="noreferrer"
              class="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {{ formatSearchUrl(run.normalizedUrl) }}
            </a>
          </template>
        </CrawlProgress>
      </CardContent>
    </Card>

    <div v-if="board.isPending.value" class="space-y-2" aria-busy="true">
      <Skeleton v-for="index in 4" :key="index" class="h-20 w-full" />
    </div>
    <ScheduleList
      v-else-if="sections.length > 0"
      :sections="sections"
      :lookup="board.lookup.value"
      :run-index="board.runIndex.value"
      :runs="board.runs.value"
      :crawl-runs="board.crawlRuns.value"
      :now="board.now.value"
      :actions="actions"
      :show-titles="false"
      :live-in-rows="false"
      @edit="openEdit"
    />
    <div v-else class="rounded-lg border bg-card">
      <EmptyState
        title="Сохранённых поисков нет"
        description="Вставьте ссылку на выдачу hh.ru: worker будет регулярно обходить все страницы и собирать вакансии."
      >
        <Button size="sm" @click="openCreate"><Plus />Новый поиск</Button>
      </EmptyState>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>История поисков</CardTitle>
        <CardDescription>
          Каждый обход: сколько страниц прошёл, сколько нашёл, добавил новых, обновил и пропустил.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          :columns="runColumns"
          :data="board.crawlRuns.value"
          :is-loading="board.isCrawlPending.value"
          :loading-row-count="6"
          filter
          filter-label="Поиск"
          filter-placeholder="Ссылка, статус или ошибка"
          empty-title="Обходов пока не было"
          empty-description="Запустите поиск кнопкой «Запустить сейчас», и здесь появится результат."
        />
      </CardContent>
    </Card>

    <ScheduleFormDialog v-model:open="dialogOpen" :schedule="editing" :kinds="['search']" />
  </section>
</template>
