import { useQuery } from "@pinia/colada"
import { conversationApi } from "./api"
import { conversationKeys } from "./model"

/** Сколько диалогов отдаёт сервер за один запрос (больше нельзя). */
export const CONVERSATION_LIMIT = 200

/**
 * Все диалоги одним списком: ящик, вкладка «Люди» и счётчик вкладки читают один
 * ключ, поэтому в кэше один запрос. Фильтры и поиск применяются на клиенте.
 */
export const useConversations = () =>
  useQuery({
    key: () => conversationKeys.list("all", ""),
    query: () => conversationApi.list({ limit: CONVERSATION_LIMIT })
  })
