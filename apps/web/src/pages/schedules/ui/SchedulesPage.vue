<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useEventListener } from "@vueuse/core"
import type { CrawlSchedule } from "@otbor/contract"
import { CircleAlert, Plus } from "@lucide/vue"
import {
  EMPTY_FILTER,
  groupSchedules,
  matchesFilter,
  parseScheduleQuery,
  scheduleQueryString,
  scheduleTarget,
  summarizeSchedules,
  type ScheduleFilter
} from "@/entities/schedule"
import { RefreshButton } from "@/features/refresh-button"
import {
  ScheduleFormDialog,
  ScheduleList,
  ScheduleSummaryStrip,
  useScheduleActions,
  useSchedulesBoard
} from "@/features/schedule-manage"
import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Skeleton } from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import ScheduleFilters from "./ScheduleFilters.vue"

const board = useSchedulesBoard()
const actions = useScheduleActions()

/* Фильтры живут в адресе: `?kind=`, `?group=`, `?errors=1`, `?off=1`. */
const filter = ref<ScheduleFilter>(parseScheduleQuery(window.location.search))

const writeQuery = (value: ScheduleFilter) => {
  const next = `${window.location.pathname}${scheduleQueryString(value)}`
  if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next)
}
watch(filter, writeQuery, { deep: true })

/** Ссылка из другой страницы меняет адрес, не пересоздавая страницу: подхватываем новый адрес. */
const syncFromLocation = () => {
  const next = parseScheduleQuery(window.location.search)
  if (scheduleQueryString(next) !== scheduleQueryString(filter.value)) filter.value = next
}
useEventListener(window, "popstate", syncFromLocation)
useEventListener(window, "click", () => void nextTick(syncFromLocation))

const summary = computed(() => summarizeSchedules(board.schedules.value, board.runningIds.value))
const filtered = computed(() => board.schedules.value.filter((schedule) => matchesFilter(schedule, filter.value)))
const sections = computed(() =>
  groupSchedules(filtered.value, (schedule) => scheduleTarget(schedule, board.lookup.value).text)
)
const filterActive = computed(() => scheduleQueryString(filter.value) !== "")

const toggleErrors = () => {
  filter.value = { ...filter.value, errorsOnly: !filter.value.errorsOnly }
}

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
</script>

<template>
  <section class="space-y-6">
    <PageHeader
      title="Расписания"
      description="Всё, что запускается само: поиск вакансий, отклики, догрузка данных, синхронизация. Когда запускалось, чем закончилось и когда пойдёт дальше."
    >
      <template #actions>
        <RefreshButton :loading="board.isRefreshing.value" @refresh="board.refresh()" />
        <Button @click="openCreate">
          <Plus />
          Добавить расписание
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="board.error.value" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить расписания</AlertTitle>
      <AlertDescription>{{ board.error.value }}</AlertDescription>
    </Alert>
    <ScheduleSummaryStrip :summary="summary" :errors-active="filter.errorsOnly" @toggle-errors="toggleErrors" />

    <ScheduleFilters v-model:filter="filter" />

    <div v-if="board.isPending.value" class="space-y-2" aria-busy="true">
      <Skeleton v-for="index in 6" :key="index" class="h-20 w-full" />
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
      @edit="openEdit"
    />

    <div v-else class="rounded-lg border bg-card">
      <EmptyState
        :title="filterActive ? 'Под фильтры ничего не подходит' : 'Расписаний пока нет'"
        :description="
          filterActive
            ? 'Попробуйте убрать часть фильтров.'
            : 'Добавьте первое: например, поиск вакансий по ссылке hh.ru.'
        "
      >
        <Button v-if="filterActive" variant="outline" size="sm" @click="filter = EMPTY_FILTER">Сбросить фильтры</Button>
        <Button v-else size="sm" @click="openCreate"><Plus />Добавить расписание</Button>
      </EmptyState>
    </div>

    <ScheduleFormDialog
      v-model:open="dialogOpen"
      :schedule="editing"
      :existing="board.schedules.value"
    />
  </section>
</template>
