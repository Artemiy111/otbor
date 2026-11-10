<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import { scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"
import { parseQueueFilter, queueFilterSearch, type QueueFilter, type QueueTab } from "@/features/queue-filter"
import { RefreshButton } from "@/features/refresh-button"
import { locationSearch, replaceSearch } from "@/shared/lib"
import { Card, CardContent } from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import BackgroundQueuePanel from "./BackgroundQueuePanel.vue"
import ConcurrencyPanel from "./ConcurrencyPanel.vue"
import JobQueuePanel from "./JobQueuePanel.vue"

/** Вкладка и фильтры живут в адресе: `?tab=&status=&stage=`, ссылкой можно поделиться. */
const filter = computed<QueueFilter>(() => parseQueueFilter(locationSearch.value))
const tab = computed<QueueTab>(() => filter.value.tab)
const openTab = (next: QueueTab) => replaceSearch(queueFilterSearch({ tab: next, status: [], stage: [] }))
const setFilter = (patch: { status?: ReadonlyArray<string>; stage?: ReadonlyArray<string> }) =>
  replaceSearch(queueFilterSearch({ ...filter.value, ...patch }))

const browserStats = useQuery({ key: () => queueJobKeys.stats("browser"), query: () => queueJobApi.stats("browser") })
const inferenceStats = useQuery({ key: () => queueJobKeys.stats("inference"), query: () => queueJobApi.stats("inference") })
const runs = useQuery({
  key: () => scheduleRunKeys.list(undefined, "all-recent"),
  query: () => scheduleRunApi.list({ limit: 200 })
})

const waiting = (s: { pending: number; leased: number; running: number } | undefined) =>
  s === undefined ? "…" : `${s.pending} ждут, ${s.leased + s.running} в работе`

const overview = computed(() => [
  {
    tab: "browser" as const,
    title: "Браузер",
    subtitle: "Работа на hh.ru под вашим аккаунтом",
    line: waiting(browserStats.data.value)
  },
  {
    tab: "inference" as const,
    title: "Генерация",
    subtitle: "Тексты, которые пишет модель",
    line: waiting(inferenceStats.data.value)
  },
  {
    tab: "background" as const,
    title: "Фоновые запуски",
    subtitle: "Поиск и обновления по расписанию",
    line:
      runs.data.value === undefined
        ? "…"
        : `${runs.data.value.items.filter((r) => r.status === "running").length} идёт сейчас`
  }
])

const browserPanel = ref<InstanceType<typeof JobQueuePanel>>()
const inferencePanel = ref<InstanceType<typeof JobQueuePanel>>()
const backgroundPanel = ref<InstanceType<typeof BackgroundQueuePanel>>()
const concurrencyPanel = ref<InstanceType<typeof ConcurrencyPanel>>()

const refresh = () => {
  void Promise.all([
    browserStats.refetch(),
    inferenceStats.refetch(),
    runs.refetch(),
    browserPanel.value?.refetch(),
    inferencePanel.value?.refetch(),
    backgroundPanel.value?.refetch(),
    concurrencyPanel.value?.refetch()
  ])
}
const isRefreshing = computed(() => browserStats.isLoading.value || inferenceStats.isLoading.value || runs.isLoading.value)
</script>

<template>
  <section>
    <PageHeader
      title="Очереди"
      description="Три очереди с разными исполнителями: браузер, генерация текстов и фоновые запуски по расписанию."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refresh" />
      </template>
    </PageHeader>

    <div class="mb-4 grid gap-3 md:grid-cols-3">
      <button v-for="item in overview" :key="item.tab" type="button" class="text-left" @click="openTab(item.tab)">
        <Card :class="tab === item.tab ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/30'">
          <CardContent class="space-y-0.5 p-4">
            <p class="text-sm font-semibold">{{ item.title }}</p>
            <p class="text-xs text-muted-foreground">{{ item.subtitle }}</p>
            <p class="pt-1 text-sm tabular-nums">{{ item.line }}</p>
          </CardContent>
        </Card>
      </button>
    </div>

    <ConcurrencyPanel ref="concurrencyPanel" class="mb-4" />

    <JobQueuePanel
      v-if="tab === 'browser'"
      ref="browserPanel"
      kind="browser"
      :status="filter.status"
      :stage="filter.stage"
      @update:filter="setFilter"
    />
    <JobQueuePanel
      v-if="tab === 'inference'"
      ref="inferencePanel"
      kind="inference"
      :status="filter.status"
      :stage="filter.stage"
      @update:filter="setFilter"
    />
    <BackgroundQueuePanel v-show="tab === 'background'" ref="backgroundPanel" />
  </section>
</template>
