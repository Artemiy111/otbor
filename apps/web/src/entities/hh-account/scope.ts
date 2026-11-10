import { computed, ref } from "vue"
import { useStorage } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountApi } from "./api"
import { hhAccountKeys } from "./model"
import { resolveAccountView, VIEW_ALL } from "./scope-model"

/** Per-page choice: «как в шапке» (фильтр аккаунта из шапки). */
export const DEFAULT_ACCOUNT = "default"
/** Per-page choice: no account filter. */
export const ALL_ACCOUNTS = "all"

/**
 * Фильтр шапки «Показывать», хранится в браузере. Пустая строка: выбора ещё не
 * было, фильтр идёт за основным аккаунтом. Ключ новый: старый
 * `otbor.default-account` хранил другое понятие и больше не читается.
 */
const storedView = useStorage<string>("otbor.account-view", "")

const useAccounts = () => {
  const accountsQuery = useQuery({
    key: () => hhAccountKeys.list(),
    query: () => hhAccountApi.list()
  })
  return computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
}

/**
 * Два разных понятия.
 * - `serverDefaultId`: основной аккаунт (`isDefault` на сервере). Его читают
 *   CLI и harness, меняется только на странице «Аккаунты hh».
 * - `viewId`: фильтр шапки («все» или один аккаунт), только для просмотра;
 *   запоминается в браузере и сам начинается с основного аккаунта.
 * `defaultAccountId` остаётся для страниц, которым нужен один конкретный
 * аккаунт: выбранный в шапке, а при «все аккаунты» основной.
 */
export const useDefaultAccount = () => {
  const accounts = useAccounts()
  const view = computed(() => resolveAccountView(accounts.value, storedView.value))
  const viewId = computed<string>({
    get: () => view.value.viewId,
    set: (id) => {
      storedView.value = id
    }
  })
  return {
    accounts,
    serverDefaultId: computed(() => view.value.serverDefaultId),
    viewId,
    /** Выбранный в шапке аккаунт; `undefined` при «все аккаунты». */
    viewAccountId: computed(() => view.value.viewAccountId),
    defaultAccountId: computed(() => view.value.actingAccountId)
  }
}

export { VIEW_ALL }

/**
 * A page-local account filter. `accountId` is the select value
 * (`"default"` = как в шапке, `"all"` or an account id); `hhAccountId` is what the API wants
 * (`undefined` = all accounts) and `scopeKey` is a stable query-key part.
 */
export const useAccountFilter = (initial: string = DEFAULT_ACCOUNT) => {
  const { accounts, viewAccountId } = useDefaultAccount()
  const accountId = ref<string>(initial)
  const hhAccountId = computed<string | undefined>(() => {
    if (accountId.value === ALL_ACCOUNTS) return undefined
    if (accountId.value === DEFAULT_ACCOUNT) return viewAccountId.value
    return accountId.value
  })
  const scopeKey = computed(() => hhAccountId.value ?? ALL_ACCOUNTS)
  /** Аккаунт, на который указывает «как в шапке»; `undefined` при «все аккаунты». */
  const defaultAccountId = viewAccountId
  return { accounts, accountId, hhAccountId, scopeKey, defaultAccountId }
}
