import { ApiError, type ConversationId, type ConversationListItem, type ConversationSummary, type OtborApi } from "@otbor/contract"
import { Effect, Schema } from "effect"
import { ref } from "vue"
import { legacySearch, type ConversationSearchInput, type InboxPage } from "./model"

type Call = <A, E>(run: (api: OtborApi) => Effect.Effect<A, E>) => Promise<A>

const isApiError = Schema.is(ApiError)

/** Старый сервер отвечает на неизвестный вызов дефектом «Unknown request tag: …». */
export const isUnknownRpc = (error: unknown): boolean => {
  const parts = [String(error), error instanceof Error ? error.message : ""]
  try {
    parts.push(JSON.stringify(error))
  } catch {
    // круговая ссылка: хватит и строки выше
  }
  return /Unknown request tag/i.test(parts.join(" "))
}

export class MarkUnsupported extends Error {
  constructor() {
    super("Сервер ещё не умеет отмечать диалоги прочитанными: перезапустите его")
  }
}

/**
 * Вызовы ящика с запасным путём для сервера, который старше клиента:
 * - `search`: нет `ConversationsSearch` - берём `ConversationsList` (до 200 строк)
 *   и фильтруем на клиенте;
 * - `markRead` / `markUnread`: нет вызова - `markAvailable` гаснет, кнопки прячутся.
 * Отказ по делу (любая `ApiError`) старым сервером не считается.
 */
export const createInboxClient = (call: Call) => {
  /** `undefined` - ещё не знаем; `false` - старый сервер, дальше сразу прежним путём. */
  let searchSupported: boolean | undefined
  const markAvailable = ref(true)

  const legacy = async (input: ConversationSearchInput): Promise<InboxPage> => {
    const list: ReadonlyArray<ConversationSummary> = await call((client) => client.ConversationsList({ limit: 200 }))
    return legacySearch(list, input)
  }

  const search = async (input: ConversationSearchInput): Promise<InboxPage> => {
    if (searchSupported === false) return legacy(input)
    try {
      const page = await call((client) => client.ConversationsSearch(input))
      searchSupported = true
      return page
    } catch (error) {
      if (isApiError(error) || searchSupported === true) throw error
      try {
        const page = await legacy(input)
        searchSupported = false
        return page
      } catch {
        throw error
      }
    }
  }

  const mark = async (run: (api: OtborApi) => Effect.Effect<ConversationListItem, unknown>): Promise<ConversationListItem> => {
    if (!markAvailable.value) throw new MarkUnsupported()
    try {
      return await call(run)
    } catch (error) {
      if (!isApiError(error) && isUnknownRpc(error)) {
        markAvailable.value = false
        throw new MarkUnsupported()
      }
      throw error
    }
  }

  return {
    search,
    markAvailable,
    markRead: (id: string) => mark((client) => client.ConversationMarkRead({ id: id as ConversationId })),
    markUnread: (id: string) => mark((client) => client.ConversationMarkUnread({ id: id as ConversationId }))
  }
}
