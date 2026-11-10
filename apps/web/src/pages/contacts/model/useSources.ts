import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import type { ConversationSummary } from "@otbor/contract"
import { hhAccountApi, hhAccountColorById, hhAccountKeys, hhAccountNameById } from "@/entities/hh-account"
import { mailAccountApi, mailAccountKeys } from "@/entities/mail-account"
import { telegramAccountApi, telegramAccountKeys } from "@/entities/telegram-account"

/**
 * Откуда приходит переписка: аккаунты hh, почты и Telegram. Нужны для цвета
 * точки и подписи у диалога и для пустого состояния («ничего не подключено»).
 */
export const useSources = () => {
  const hh = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
  const mail = useQuery({ key: () => mailAccountKeys.list(), query: () => mailAccountApi.list() })
  const telegram = useQuery({ key: () => telegramAccountKeys.list(), query: () => telegramAccountApi.list() })

  const hhAccounts = computed(() => hh.data.value ?? [])
  const mailAccounts = computed(() => mail.data.value ?? [])
  const telegramAccounts = computed(() => telegram.data.value ?? [])

  const accountName = (conversation: Pick<ConversationSummary, "channel" | "accountId">): string => {
    if (conversation.channel === "hh_chat") return hhAccountNameById(hhAccounts.value, conversation.accountId)
    const list = conversation.channel === "mail" ? mailAccounts.value : telegramAccounts.value
    const found = list.find((account) => account.id === conversation.accountId)
    if (found === undefined) return conversation.accountId.slice(0, 8)
    return "address" in found ? found.address : found.label
  }

  const accountColor = (accountId: string): string => hhAccountColorById(hhAccounts.value, accountId)

  return {
    accountName,
    accountColor,
    loaded: computed(() => !hh.isPending.value && !mail.isPending.value && !telegram.isPending.value),
    hasMail: computed(() => mailAccounts.value.length > 0),
    hasTelegram: computed(() => telegramAccounts.value.length > 0)
  }
}

export type Sources = ReturnType<typeof useSources>
