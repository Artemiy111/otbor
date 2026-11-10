import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core"
import { crawlRunApi } from "@/entities/crawl-run"
import { healthApi, healthKeys } from "@/entities/health"
import { hydrationApi } from "@/entities/hydration"
import { overviewApi, overviewKeys, useOverviewWindow } from "@/entities/overview"
import { scheduleApi } from "@/entities/schedule"
import { scheduleRunApi } from "@/entities/schedule-run"
import { buildAttention } from "./attention"
import { buildVerdict } from "./verdict"

/** Снимок обзора обновляется раз в 20 секунд, здоровье и «сейчас» раз в 15. */
const OVERVIEW_POLL_MS = 20_000
const LIVE_POLL_MS = 15_000

/**
 * Все данные страницы «Обзор» и то, что из них выведено. Опросы стоят, пока
 * вкладка скрыта; при возврате на вкладку Pinia Colada сама обновляет
 * устаревшее. Старые данные остаются на экране, пока идёт обновление.
 */
export const useOverviewData = () => {
  const days = useOverviewWindow()

  const overview = useQuery({
    key: () => overviewKeys.get(days.value),
    query: () => overviewApi.get(days.value),
    staleTime: 10_000,
    // При смене окна показываем прежние числа, а не скелетон.
    placeholderData: (previous) => previous
  })
  const health = useQuery({
    key: () => healthKeys.current(),
    query: () => healthApi.get(),
    staleTime: 10_000
  })
  const schedules = useQuery({
    key: () => overviewKeys.schedules(),
    query: () => scheduleApi.list(),
    staleTime: 10_000
  })
  const crawls = useQuery({
    key: () => overviewKeys.liveCrawls(),
    query: async () => (await crawlRunApi.list({ limit: 8 })).items,
    staleTime: 5_000
  })
  const scheduleRuns = useQuery({
    key: () => overviewKeys.liveScheduleRuns(),
    query: async () => (await scheduleRunApi.list({ limit: 12 })).items,
    staleTime: 5_000
  })
  const proxy = useQuery({
    key: () => overviewKeys.proxy(),
    query: () => hydrationApi.proxyStatus(),
    staleTime: 30_000
  })

  const visibility = useDocumentVisibility()
  const visible = () => visibility.value !== "hidden"
  useIntervalFn(() => {
    if (visible()) void overview.refetch()
  }, OVERVIEW_POLL_MS)
  useIntervalFn(() => {
    if (!visible()) return
    void health.refetch()
    void schedules.refetch()
    void crawls.refetch()
    void scheduleRuns.refetch()
    void proxy.refresh()
  }, LIVE_POLL_MS)

  const refreshAll = async () => {
    await Promise.allSettled([
      overview.refetch(),
      health.refetch(),
      schedules.refetch(),
      crawls.refetch(),
      scheduleRuns.refetch(),
      proxy.refetch()
    ])
  }

  /** Тик раз в 5 секунд: «обновлено N с назад» и обратные отсчёты. */
  const now = ref(Date.now())
  useIntervalFn(() => {
    now.value = Date.now()
  }, 5_000)

  /** Сервер молчит, если запрос здоровья упал. */
  const healthFailed = computed(() => health.status.value === "error")
  const firstLoad = computed(() => overview.data.value === undefined && overview.status.value === "pending")
  const overviewFailed = computed(() => overview.status.value === "error")

  const attentionInput = computed(() => ({
    overview: overview.data.value,
    health: health.data.value,
    healthFailed: healthFailed.value,
    schedules: schedules.data.value,
    proxy: proxy.data.value,
    now: now.value
  }))
  const items = computed(() => buildAttention(attentionInput.value))
  const verdict = computed(() =>
    buildVerdict({
      ...attentionInput.value,
      items: items.value,
      overviewFailed: overview.data.value === undefined && overviewFailed.value
    })
  )

  return {
    days,
    overview,
    health,
    schedules,
    crawls,
    scheduleRuns,
    proxy,
    now,
    items,
    verdict,
    healthFailed,
    firstLoad,
    overviewFailed,
    refreshAll
  }
}

export type OverviewData = ReturnType<typeof useOverviewData>
