import type { CrawlRun } from "@otbor/contract"
import { normalizeSearchUrl } from "@otbor/contract"

export const crawlRunKeys = {
  all: ["crawl-runs"] as const,
  list: (url?: string) => ["crawl-runs", "list", url ?? "all"] as const
}

export const crawlStatusLabel = (status: CrawlRun["status"]): string => {
  switch (status) {
    case "running": return "Идёт поиск"
    case "done": return "Завершён"
    case "stopped": return "Остановлен"
    case "error": return "Ошибка"
  }
}

export const crawlStatusVariant = (status: CrawlRun["status"]): "info" | "success" | "warning" | "destructive" => {
  switch (status) {
    case "running": return "info"
    case "done": return "success"
    case "stopped": return "warning"
    case "error": return "destructive"
  }
}

/** «страница 3 из 20» или «страница 3, всего неизвестно». */
export const pagePosition = (run: CrawlRun): string => {
  const current = run.currentPage === null ? run.pagesDone : run.currentPage + 1
  return run.pagesTotal === null || run.pagesTotal === undefined
    ? `страница ${Math.max(1, current)}, всего неизвестно`
    : `страница ${Math.max(1, current)} из ${run.pagesTotal}`
}

export const progressPercent = (run: CrawlRun): number | null => {
  if (run.pagesTotal === null || run.pagesTotal === undefined || run.pagesTotal <= 0) return null
  return Math.min(100, Math.max(0, Math.round((run.pagesDone / run.pagesTotal) * 100)))
}

export const elapsedLabel = (startedAt: string, now: number = Date.now()): string => {
  const millis = Math.max(0, now - new Date(startedAt).getTime())
  const minutes = Math.floor(millis / 60_000)
  if (minutes >= 1) return `${minutes} мин`
  return `${Math.max(1, Math.floor(millis / 1_000))} сек`
}

/** Идущий поиск, который давно не двигается: вероятно, worker остановился. */
export const isStaleCrawl = (run: CrawlRun, now: number = Date.now()): boolean =>
  run.status === "running" && now - new Date(run.startedAt).getTime() > 15 * 60_000

/** Идущий поиск по ссылке расписания. */
export const runningCrawlFor = (
  runs: ReadonlyArray<CrawlRun>,
  targetUrl: string
): CrawlRun | undefined => {
  const normalized = normalizeSearchUrl(targetUrl)
  return runs.find((run) => run.status === "running" && run.normalizedUrl === normalized)
}
