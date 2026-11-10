import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core"
import type { CrawlRun, CrawlSchedule, ScheduleKind, ScheduleRun } from "@otbor/contract"
import { crawlRunApi, crawlRunKeys } from "@/entities/crawl-run"
import { hhAccountApi, hhAccountKeys, hhAccountName } from "@/entities/hh-account"
import { mailAccountApi, mailAccountKeys } from "@/entities/mail-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { scheduleApi, scheduleKeys, type TargetLookup } from "@/entities/schedule"
import { indexRuns, scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"
import { telegramAccountApi, telegramAccountKeys } from "@/entities/telegram-account"
import { describeError } from "@/shared/lib"

const IDLE_POLL_MS = 15_000
const BUSY_POLL_MS = 3_000

/**
 * Всё, что нужно списку расписаний: сами расписания, их запуски, идущие
 * поиски, подписи целей и «сейчас» для обратного отсчёта. Опрос один на
 * страницу: чаще, пока что-то выполняется, и пауза, пока вкладка скрыта.
 */
export const useSchedulesBoard = (only?: ReadonlyArray<ScheduleKind>) => {
  const schedulesQuery = useQuery({ key: () => scheduleKeys.list(), query: () => scheduleApi.list() })
  const runsQuery = useQuery({
    key: () => scheduleRunKeys.list(undefined, "all-recent"),
    query: () => scheduleRunApi.list({ limit: 200 })
  })
  const crawlQuery = useQuery({ key: () => crawlRunKeys.list(), query: () => crawlRunApi.list({ limit: 50 }) })
  const mailQuery = useQuery({ key: () => mailAccountKeys.list(), query: () => mailAccountApi.list() })
  const telegramQuery = useQuery({ key: () => telegramAccountKeys.list(), query: () => telegramAccountApi.list() })
  const hhQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
  const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

  const schedules = computed<ReadonlyArray<CrawlSchedule>>(() => {
    const all = schedulesQuery.data.value ?? []
    return only === undefined ? all : all.filter((schedule) => only.includes(schedule.kind))
  })
  const runs = computed<ReadonlyArray<ScheduleRun>>(() => runsQuery.data.value?.items ?? [])
  const crawlRuns = computed<ReadonlyArray<CrawlRun>>(() => crawlQuery.data.value?.items ?? [])
  const runIndex = computed(() => indexRuns(runs.value))
  const runningIds = computed(() => new Set(runIndex.value.running.keys()))

  const lookup = computed<TargetLookup>(() => ({
    mail: new Map((mailQuery.data.value ?? []).map((account) => [account.id as string, account.label])),
    telegram: new Map((telegramQuery.data.value ?? []).map((account) => [account.id as string, account.label])),
    hhAccounts: new Map((hhQuery.data.value ?? []).map((account) => [account.id as string, hhAccountName(account)])),
    resumes: new Map((resumesQuery.data.value ?? []).map((resume) => [resume.id as string, resume.title]))
  }))

  const now = ref(Date.now())
  const anyRunning = computed(
    () => runningIds.value.size > 0 || crawlRuns.value.some((run) => run.status === "running")
  )

  const refresh = () =>
    Promise.allSettled([schedulesQuery.refetch(), runsQuery.refetch(), crawlQuery.refetch()])

  const visibility = useDocumentVisibility()
  const poll = useIntervalFn(
    () => {
      now.value = Date.now()
      if (document.hidden) return
      void refresh()
    },
    computed(() => (anyRunning.value ? BUSY_POLL_MS : IDLE_POLL_MS))
  )
  // Вернулись на вкладку: сразу свежие данные, а не через интервал.
  watch(visibility, (state) => {
    if (state === "visible") {
      now.value = Date.now()
      void refresh()
    }
  })

  const error = computed(() => {
    const failure = schedulesQuery.error.value
    return failure === null || failure === undefined ? null : describeError(failure)
  })

  return {
    schedules,
    runs,
    crawlRuns,
    runIndex,
    runningIds,
    lookup,
    now,
    anyRunning,
    error,
    isPending: computed(() => schedulesQuery.isPending.value),
    isCrawlPending: computed(() => crawlQuery.isPending.value),
    isRefreshing: computed(() => schedulesQuery.isLoading.value || runsQuery.isLoading.value),
    refresh,
    stopPolling: poll.pause
  }
}
