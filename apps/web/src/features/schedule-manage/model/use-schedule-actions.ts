import { onBeforeUnmount, ref } from "vue"
import { useQueryCache } from "@pinia/colada"
import type { CrawlSchedule } from "@otbor/contract"
import { crawlRunKeys } from "@/entities/crawl-run"
import { scheduleApi, scheduleKeys, scheduleKindName, type ScheduleUpsertInput } from "@/entities/schedule"
import { scheduleRunKeys } from "@/entities/schedule-run"
import { describeError } from "@/shared/lib"

export interface ScheduleNotice {
  readonly tone: "info" | "warning"
  readonly text: string
}

/**
 * Действия над расписаниями: сохранить, включить, запустить, удалить. Все
 * страницы с расписаниями используют одни и те же действия и одни и те же
 * сообщения; страница только показывает `notice` и `error`.
 */
export const useScheduleActions = () => {
  const queryCache = useQueryCache()
  const notice = ref<ScheduleNotice | null>(null)
  const error = ref<string | null>(null)
  /** Расписания, над которыми сейчас идёт действие. */
  const starting = ref(new Set<string>())
  const removing = ref(new Set<string>())
  const toggling = ref(new Set<string>())
  const saving = ref(false)

  const mark = (target: typeof starting, id: string, on: boolean) => {
    const next = new Set(target.value)
    if (on) next.add(id)
    else next.delete(id)
    target.value = next
  }

  const refresh = async () => {
    await Promise.all([
      queryCache.invalidateQueries({ key: scheduleKeys.all }),
      queryCache.invalidateQueries({ key: scheduleRunKeys.all }),
      queryCache.invalidateQueries({ key: crawlRunKeys.all })
    ])
  }

  /** Запуск идёт в фоне: одно отложенное обновление, дальше работает опрос страницы. */
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  onBeforeUnmount(() => {
    if (refreshTimer !== null) clearTimeout(refreshTimer)
  })

  const reset = () => {
    notice.value = null
    error.value = null
  }

  const save = async (input: ScheduleUpsertInput): Promise<CrawlSchedule | null> => {
    reset()
    saving.value = true
    try {
      const saved = await scheduleApi.upsert(input)
      notice.value = {
        tone: "info",
        text: input.id === undefined ? "Расписание создано." : "Изменения сохранены."
      }
      await refresh()
      return saved
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      saving.value = false
    }
  }

  const toggle = async (schedule: CrawlSchedule, enabled: boolean) => {
    reset()
    mark(toggling, schedule.id, true)
    try {
      await scheduleApi.upsert({
        id: schedule.id,
        kind: schedule.kind,
        targetId: schedule.targetId,
        intervalMinutes: schedule.intervalMinutes,
        options: schedule.options,
        enabled
      })
      notice.value = {
        tone: "info",
        text: enabled ? `Включено: ${scheduleKindName(schedule.kind)}.` : `Выключено: ${scheduleKindName(schedule.kind)}.`
      }
      await refresh()
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      mark(toggling, schedule.id, false)
    }
  }

  const run = async (schedule: CrawlSchedule) => {
    reset()
    mark(starting, schedule.id, true)
    try {
      const result = await scheduleApi.runNow(schedule.id)
      notice.value = result.accepted
        ? { tone: "info", text: "Запуск принят, работа идёт в фоне." }
        : { tone: "warning", text: "Запуск не принят: возможно, это расписание уже выполняется." }
      if (result.accepted) {
        if (refreshTimer !== null) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void refresh()
        }, 1_500)
      }
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      mark(starting, schedule.id, false)
    }
  }

  const remove = async (schedule: CrawlSchedule) => {
    reset()
    mark(removing, schedule.id, true)
    try {
      const result = await scheduleApi.remove(schedule.id)
      notice.value = result.deleted
        ? { tone: "info", text: "Расписание удалено." }
        : { tone: "warning", text: "Расписание не удалено: такой записи уже нет." }
      await refresh()
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      mark(removing, schedule.id, false)
    }
  }

  return { notice, error, saving, starting, removing, toggling, save, toggle, run, remove, reset, refresh }
}
