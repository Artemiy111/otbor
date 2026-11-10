import { computed, toValue, type MaybeRefOrGetter } from "vue"
import { useInfiniteQuery, useQuery } from "@pinia/colada"
import { conversationApi } from "./api"
import { conversationKeys, INBOX_PAGE_SIZE, type InboxFilterKey, type InboxPage } from "./model"

/**
 * Ящик: страницы диалогов с серверным поиском и фильтрами. Архивные не
 * показываются. Следующая страница берётся по числу уже загруженных строк.
 */
export const useInbox = (filter: MaybeRefOrGetter<InboxFilterKey>) => {
  const query = useInfiniteQuery<InboxPage, Error, number>({
    key: () => conversationKeys.inbox(toValue(filter)),
    initialPageParam: 0,
    query: ({ pageParam }) => {
      const current = toValue(filter)
      return conversationApi.search({
        archived: false,
        limit: INBOX_PAGE_SIZE,
        offset: pageParam,
        ...(current.search.trim() === "" ? {} : { search: current.search.trim() }),
        ...(current.channel === "all" ? {} : { channel: current.channel }),
        ...(current.unread ? { unread: true } : {})
      })
    },
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.items.length, 0)
      return last.items.length > 0 && loaded < last.total ? loaded : null
    }
  })

  const pages = computed(() => query.data.value?.pages ?? [])
  return {
    query,
    items: computed(() => pages.value.flatMap((page) => page.items)),
    /** Сколько диалогов подходит под фильтры (по первой странице: она обновляется первой). */
    total: computed(() => pages.value[0]?.total ?? 0),
    unreadTotal: computed(() => pages.value[0]?.unreadTotal ?? 0)
  }
}

/** Число непрочитанных диалогов для вкладки «Диалоги»; без фильтров и поиска. */
export const useUnreadTotal = () => {
  const query = useQuery({
    key: () => conversationKeys.unreadTotal(),
    query: () => conversationApi.search({ archived: false, limit: 1 }).then((page) => page.unreadTotal)
  })
  return computed(() => query.data.value ?? 0)
}
