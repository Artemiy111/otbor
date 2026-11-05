import { computed, onBeforeUnmount, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ScheduleRun } from "@otbor/contract"
import { applyFilterKeys } from "@/entities/apply-filter"
import { autoApplyKeys } from "@/entities/auto-apply"
import { scheduleApi, scheduleKeys } from "@/entities/schedule"
import { scheduleRunApi } from "@/entities/schedule-run"
import { describeError } from "@/shared/lib"

export interface RunCounts {
  readonly selected: number
  readonly created: number
  readonly writingEnqueued: number
  readonly kitsSet: number
  readonly submitQueued: number
  readonly needsHuman: number
}

export const RUN_COUNT_LABELS: ReadonlyArray<readonly [keyof RunCounts, string]> = [
  ["selected", "выбрано"],
  ["created", "создано откликов"],
  ["writingEnqueued", "писем в работе"],
  ["kitsSet", "готово китов"],
  ["submitQueued", "в очереди на отправку"],
  ["needsHuman", "нужен человек"]
]

const asCounts = (run: ScheduleRun): RunCounts | null => {
  const detail = run.detail
  if (detail === null || detail === undefined || typeof detail !== "object") return null
  const record = detail as Record<string, unknown>
  const pick = (key: keyof RunCounts) => (typeof record[key] === "number" ? (record[key] as number) : 0)
  return {
    selected: pick("selected"),
    created: pick("created"),
    writingEnqueued: pick("writingEnqueued"),
    kitsSet: pick("kitsSet"),
    submitQueued: pick("submitQueued"),
    needsHuman: pick("needsHuman")
  }
}

/**
 * The user-wide `apply` schedule and its "run now": shared by the apply-filter
 * page (which also creates the schedule when saving) and the auto-apply page.
 */
export const useAutoApplyRun = (options: {
  readonly accountId: () => string
  /** Whether a schedule created on demand starts enabled. */
  readonly scheduleEnabled: () => boolean
}) => {
  const queryCache = useQueryCache()

  const schedulesQuery = useQuery({ key: () => scheduleKeys.list(), query: () => scheduleApi.list() })
  const applySchedule = computed(
    () => (schedulesQuery.data.value ?? []).find((schedule) => schedule.kind === "apply") ?? null
  )

  /** One user-wide `apply` schedule (target `global` covers every hh account). */
  const ensureSchedule = async (enabled: boolean) => {
    const existing = applySchedule.value
    if (existing !== null) return existing
    const created = await scheduleApi.upsert({
      kind: "apply",
      targetId: "global",
      intervalMinutes: 15,
      enabled
    })
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
    return created
  }

  const runState = ref<"idle" | "waiting" | "done" | "error">("idle")
  const runCounts = ref<RunCounts | null>(null)
  const runError = ref<string | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const stopPolling = () => {
    if (pollTimer !== null) clearInterval(pollTimer)
    pollTimer = null
  }
  onBeforeUnmount(stopPolling)

  const runMutation = useMutation({
    mutation: async (_: void) => {
      const schedule = await ensureSchedule(options.scheduleEnabled())
      const startedAt = Date.now() - 2000
      const accepted = await scheduleApi.runNow(schedule.id)
      return { scheduleId: schedule.id, startedAt, accepted: accepted.accepted }
    }
  })

  const run = async () => {
    runError.value = null
    runCounts.value = null
    stopPolling()
    try {
      const { scheduleId, startedAt } = await runMutation.mutateAsync()
      runState.value = "waiting"
      let attempts = 0
      pollTimer = setInterval(async () => {
        attempts += 1
        try {
          const page = await scheduleRunApi.list({ scheduleId, limit: 1 })
          const latest = page.items[0]
          if (latest !== undefined && Date.parse(latest.startedAt) >= startedAt && latest.status !== "running") {
            stopPolling()
            if (latest.status === "error") {
              runState.value = "error"
              runError.value = latest.error ?? "Запуск завершился ошибкой."
            } else {
              runState.value = "done"
              runCounts.value = asCounts(latest)
            }
            await Promise.all([
              queryCache.invalidateQueries({ key: applyFilterKeys.usage(options.accountId()) }),
              queryCache.invalidateQueries({ key: autoApplyKeys.all }),
              queryCache.invalidateQueries({ key: scheduleKeys.all })
            ])
            return
          }
        } catch {
          // Try again on the next tick.
        }
        if (attempts >= 40) {
          stopPolling()
          runState.value = "idle"
          runError.value = "Результат пока не готов. Смотрите страницу расписаний."
        }
      }, 3000)
    } catch (error) {
      runState.value = "error"
      runError.value = describeError(error)
    }
  }

  return { applySchedule, ensureSchedule, run, runState, runCounts, runError, running: runMutation.isLoading }
}
