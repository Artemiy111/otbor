import { computed, ref } from "vue"
import { useStorage } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountApi } from "./api"
import { hhAccountKeys } from "./model"

/** Per-page choice: the app's default account. */
export const DEFAULT_ACCOUNT = "default"
/** Per-page choice: no account filter. */
export const ALL_ACCOUNTS = "all"

/** The operator's own pick of the default account (id), persisted in the browser. */
const storedDefault = useStorage<string>("otbor.default-account", "")

const useAccounts = () => {
  const accountsQuery = useQuery({
    key: () => hhAccountKeys.list(),
    query: () => hhAccountApi.list()
  })
  return computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
}

/**
 * The default account: the stored pick if it still exists, else the account
 * hh marks as default, else the first one.
 */
export const useDefaultAccount = () => {
  const accounts = useAccounts()
  const defaultAccountId = computed<string | undefined>({
    get: () => {
      const list = accounts.value
      return (
        list.find((account) => account.id === storedDefault.value) ??
        list.find((account) => account.isDefault) ??
        list[0]
      )?.id
    },
    set: (id) => {
      storedDefault.value = id ?? ""
    }
  })
  return { accounts, defaultAccountId }
}

/**
 * A page-local account filter. `accountId` is the select value
 * (`"default"`, `"all"` or an account id); `hhAccountId` is what the API wants
 * (`undefined` = all accounts) and `scopeKey` is a stable query-key part.
 */
export const useAccountFilter = (initial: string = DEFAULT_ACCOUNT) => {
  const { accounts, defaultAccountId } = useDefaultAccount()
  const accountId = ref<string>(initial)
  const hhAccountId = computed<string | undefined>(() => {
    if (accountId.value === ALL_ACCOUNTS) return undefined
    if (accountId.value === DEFAULT_ACCOUNT) return defaultAccountId.value
    return accountId.value
  })
  const scopeKey = computed(() => hhAccountId.value ?? ALL_ACCOUNTS)
  return { accounts, accountId, hhAccountId, scopeKey, defaultAccountId }
}
