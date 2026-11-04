import { computed } from "vue"
import { useStorage } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountApi } from "./api"
import { hhAccountKeys } from "./model"

export const ALL_ACCOUNTS = "all"

/** Shared across the whole UI and persisted, so every page sees the same choice. */
const selection = useStorage<string>("otbor.account-scope", ALL_ACCOUNTS)

/**
 * The global account scope. `accountId` is `"all"` or an account id;
 * `hhAccountId` is `undefined` for "all", ready to pass to API inputs.
 */
export const useAccountScope = () => {
  const accountsQuery = useQuery({
    key: () => hhAccountKeys.list(),
    query: () => hhAccountApi.list()
  })
  const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])

  /** A stored id that no longer exists falls back to "all" once accounts are known. */
  const accountId = computed<string>({
    get: () => {
      const value = selection.value
      if (value === ALL_ACCOUNTS) return value
      if (accountsQuery.data.value === undefined) return value
      return accounts.value.some((account) => account.id === value) ? value : ALL_ACCOUNTS
    },
    set: (value) => {
      selection.value = value
    }
  })

  const hhAccountId = computed(() => (accountId.value === ALL_ACCOUNTS ? undefined : accountId.value))
  const selected = computed(() => accounts.value.find((account) => account.id === accountId.value) ?? null)

  return { accounts, accountId, hhAccountId, selected }
}
