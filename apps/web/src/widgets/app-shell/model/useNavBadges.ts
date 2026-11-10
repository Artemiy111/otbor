import { computed, watch, type ComputedRef } from "vue"
import { useQuery } from "@pinia/colada"
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core"
import { hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { overviewApi, overviewKeys, useOverviewWindow } from "@/entities/overview"
import { queueJobApi, queueJobKeys } from "@/entities/queue-job"
import type { StatusTone } from "@/shared/lib"

/** Пункты навигации, у которых бывает счётчик. Добавьте id сюда и источник ниже. */
export type NavBadgeId = "accounts" | "queue" | "applications" | "contacts"

export interface NavBadge {
  readonly count: number
  readonly tone: Extract<StatusTone, "warning" | "danger">
}

/** Как часто обновлять счётчики; на скрытой вкладке опрос стоит. */
const POLL_MS = 30_000

/**
 * Счётчики «требует внимания» для боковой панели. Один интервал на все
 * источники, пауза при `document.hidden`. Вызывать один раз (в AppSidebar).
 */
export const useNavBadges = (): ComputedRef<Partial<Record<NavBadgeId, NavBadge>>> => {
  const accounts = useQuery({
    key: () => hhAccountKeys.list(),
    query: () => hhAccountApi.list()
  })
  const queue = useQuery({
    key: () => queueJobKeys.stats(),
    query: () => queueJobApi.stats()
  })
  // Тот же ключ и то же окно, что у страницы «Обзор»: в кэше один запрос.
  const days = useOverviewWindow()
  const overview = useQuery({
    key: () => overviewKeys.get(days.value),
    query: () => overviewApi.get(days.value),
    staleTime: 10_000
  })

  /*
   * ТОЧКА РАСШИРЕНИЯ для обзора. Чтобы добавить счётчик:
   *  1) добавить id в `NavBadgeId`;
   *  2) завести useQuery выше (ключ общий со страницей, чтобы кэш был один);
   *  3) добавить в `sources` computed с `{ count, tone }` и в `refresh` его refetch.
   * Ожидаются: `applications` (отклики, требующие человека: needs_human и
   * черновики на проверку) и `contacts` (непрочитанные диалоги).
   */
  const sources: Record<NavBadgeId, ComputedRef<NavBadge>> = {
    accounts: computed(() => {
      const list = accounts.data.value ?? []
      const blocked = list.filter((account) => account.submitBlockedAt != null).length
      const brokenSession = list.filter(
        (account) =>
          account.submitBlockedAt == null &&
          account.session != null &&
          account.session.state !== "ok"
      ).length
      return { count: blocked + brokenSession, tone: blocked > 0 ? "danger" : "warning" }
    }),
    queue: computed(() => {
      const stats = queue.data.value
      return { count: (stats?.needsHuman ?? 0) + (stats?.needsReconcile ?? 0), tone: "warning" }
    }),
    // Отклики: остановились и ждут человека, закончились ошибкой или ждут проверки черновика.
    applications: computed(() => {
      const applications = overview.data.value?.applications
      if (applications === undefined) return { count: 0, tone: "warning" }
      const stopped = applications.byState.needs_human + applications.byState.failed
      return {
        count: stopped + applications.draftsToReview,
        tone: applications.byState.failed > 0 ? "danger" : "warning"
      }
    }),
    contacts: computed(() => ({ count: overview.data.value?.inbox.unreadConversations ?? 0, tone: "warning" }))
  }

  const refresh = () => {
    void accounts.refetch()
    void queue.refetch()
    // refresh не трогает свежие данные: страница обзора сама опрашивает каждые 20 с.
    void overview.refresh()
  }

  const visibility = useDocumentVisibility()
  const { pause, resume } = useIntervalFn(refresh, POLL_MS, { immediate: false })
  // Опрос идёт только пока вкладка видна; при возврате обновляем сразу.
  watch(
    visibility,
    (state) => {
      if (state === "hidden") pause()
      else {
        resume()
        refresh()
      }
    },
    { immediate: true }
  )

  return computed(() => {
    const result: Partial<Record<NavBadgeId, NavBadge>> = {}
    for (const id of Object.keys(sources) as NavBadgeId[]) {
      const badge = sources[id].value
      if (badge.count > 0) result[id] = badge
    }
    return result
  })
}
