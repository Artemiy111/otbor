import { useQueryCache } from "@pinia/colada"
import type { Overview } from "@otbor/contract"
import { useToast } from "@/shared/ui"
import { describeError } from "@/shared/lib"
import { conversationApi } from "./api"
import { MarkUnsupported } from "./compat"
import { conversationKeys, patchInboxPages, unreadDelta, type InboxPage } from "./model"

/** Ключи снимков обзора начинаются так; живые данные «Сейчас» лежат под другим префиксом. */
const OVERVIEW_SNAPSHOTS = ["overview", "get"] as const

interface Target {
  readonly id: string
  readonly unreadCount: number
  readonly archived: boolean
}

/**
 * Отметки «прочитано / непрочитано». Меняют только состояние otbor на сервере.
 * Сначала правится кэш (пилюля в списке, вкладка «Диалоги», счётчик боковой
 * панели и снимок обзора), потом идёт запрос; при ошибке всё откатывается.
 */
export const useConversationRead = () => {
  const queryCache = useQueryCache()
  const toast = useToast()
  const inFlight = new Set<string>()

  const patchCaches = (target: Target, unread: number, previous: number) => {
    queryCache.setQueriesData<{ pages: ReadonlyArray<InboxPage>; pageParams: ReadonlyArray<unknown> }>(
      { key: conversationKeys.inboxAll },
      (data) => (data === undefined ? data! : patchInboxPages(data, target.id, unread))
    )
    const delta = unreadDelta(previous, unread, target.archived)
    if (delta === 0) return
    queryCache.setQueryData<number>(conversationKeys.unreadTotal(), (old) =>
      old === undefined ? (undefined as never) : Math.max(0, old + delta)
    )
    queryCache.setQueriesData<Overview>({ key: OVERVIEW_SNAPSHOTS }, (overview) =>
      overview === undefined || overview.inbox === undefined
        ? overview!
        : {
          ...overview,
          inbox: { ...overview.inbox, unreadConversations: Math.max(0, overview.inbox.unreadConversations + delta) }
        }
    )
  }

  const run = async (
    target: Target,
    optimistic: number,
    send: () => ReturnType<typeof conversationApi.markRead>,
    failure: string
  ): Promise<void> => {
    if (inFlight.has(target.id)) return
    inFlight.add(target.id)
    const previous = target.unreadCount
    patchCaches(target, optimistic, previous)
    try {
      const saved = await send()
      // Сервер знает точное число (после «непрочитано» это может быть не 1).
      if (saved.unreadCount !== optimistic) patchCaches({ ...target, unreadCount: optimistic }, saved.unreadCount, optimistic)
      await Promise.all([
        queryCache.invalidateQueries({ key: conversationKeys.detail(target.id) }),
        queryCache.invalidateQueries({ key: OVERVIEW_SNAPSHOTS })
      ])
    } catch (error) {
      patchCaches({ ...target, unreadCount: optimistic }, previous, optimistic)
      if (!(error instanceof MarkUnsupported)) toast.error(failure, { description: describeError(error) })
    } finally {
      inFlight.delete(target.id)
    }
  }

  return {
    markRead: (target: Target) =>
      run(target, 0, () => conversationApi.markRead(target.id), "Не удалось отметить диалог прочитанным"),
    markUnread: (target: Target) =>
      run(target, Math.max(1, target.unreadCount), () => conversationApi.markUnread(target.id), "Не удалось отметить диалог непрочитанным")
  }
}
