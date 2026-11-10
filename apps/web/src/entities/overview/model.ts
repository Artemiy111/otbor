import { useStorage } from "@vueuse/core"
import type { Ref } from "vue"

/** Доступные окна обзора, сутки. */
export const OVERVIEW_WINDOWS = [7, 14, 30] as const
export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number]

export const overviewKeys = {
  all: ["overview"] as const,
  get: (days: number) => ["overview", "get", days] as const,
  /** Живые данные «Сейчас»: свои ключи, чтобы не пересекаться со списками других страниц. */
  liveCrawls: () => ["overview", "live", "crawl-runs"] as const,
  liveScheduleRuns: () => ["overview", "live", "schedule-runs"] as const,
  schedules: () => ["overview", "live", "schedules"] as const,
  proxy: () => ["overview", "live", "proxy"] as const
}

/**
 * Выбранное окно хранится в браузере. Один и тот же ключ у страницы и у
 * счётчиков боковой панели, поэтому запрос обзора в кэше один.
 */
export const useOverviewWindow = (): Ref<number> => {
  const days = useStorage<number>("otbor.overview.days", 7)
  if (!(OVERVIEW_WINDOWS as ReadonlyArray<number>).includes(days.value)) days.value = 7
  return days
}
