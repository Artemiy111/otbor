import { onBeforeUnmount, ref } from "vue"
import { useQueryCache } from "@pinia/colada"
import type { CrawlSchedule } from "@otbor/contract"
import { crawlRunKeys } from "@/entities/crawl-run"
import { scheduleApi, scheduleKeys, scheduleKindName, type ScheduleUpsertInput } from "@/entities/schedule"
import { scheduleRunKeys } from "@/entities/schedule-run"
import { describeError } from "@/shared/lib"
import { useToast } from "@/shared/ui"

/**
 * Действия над расписаниями: сохранить, включить, запустить, удалить. Все
 * страницы с расписаниями используют одни и те же действия и одни и те же
 * сообщения: результат каждого действия уходит в уведомления.
 */
export const useScheduleActions = () => {
  const queryCache = useQueryCache()
  const toast = useToast()
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

  const save = async (input: ScheduleUpsertInput): Promise<CrawlSchedule | null> => {
    saving.value = true
    try {
      const saved = await scheduleApi.upsert(input)
      if (input.id !== undefined) toast.success("Сохранено")
      else toast.success(input.kind === "search" ? "Поиск создан" : "Расписание создано")
      await refresh()
      return saved
    } catch (cause) {
      toast.error("Не удалось сохранить", { description: describeError(cause) })
      return null
    } finally {
      saving.value = false
    }
  }

  const toggle = async (schedule: CrawlSchedule, enabled: boolean) => {
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
      toast.success(enabled ? "Расписание включено" : "Расписание выключено", {
        description: scheduleKindName(schedule.kind)
      })
      await refresh()
    } catch (cause) {
      toast.error("Не удалось изменить расписание", { description: describeError(cause) })
    } finally {
      mark(toggling, schedule.id, false)
    }
  }

  const run = async (schedule: CrawlSchedule) => {
    mark(starting, schedule.id, true)
    try {
      const result = await scheduleApi.runNow(schedule.id)
      if (result.accepted) toast.info("Запуск принят", { description: "Работа идёт в фоне." })
      else toast.warning("Запуск не принят", { description: "Возможно, это расписание уже выполняется." })
      if (result.accepted) {
        if (refreshTimer !== null) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void refresh()
        }, 1_500)
      }
    } catch (cause) {
      toast.error("Не удалось запустить", { description: describeError(cause) })
    } finally {
      mark(starting, schedule.id, false)
    }
  }

  const remove = async (schedule: CrawlSchedule) => {
    mark(removing, schedule.id, true)
    try {
      const result = await scheduleApi.remove(schedule.id)
      if (result.deleted) toast.success("Расписание удалено")
      else toast.warning("Расписание не удалено", { description: "Такой записи уже нет." })
      await refresh()
    } catch (cause) {
      toast.error("Не удалось удалить расписание", { description: describeError(cause) })
    } finally {
      mark(removing, schedule.id, false)
    }
  }

  return { saving, starting, removing, toggling, save, toggle, run, remove, refresh }
}
