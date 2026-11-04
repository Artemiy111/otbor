import type { HhAccountRecord } from "@otbor/contract"
import type { HeaderFilterOption } from "@/shared/ui"
import {
  ALL_ACCOUNTS,
  DEFAULT_ACCOUNT,
  hhAccountColor,
  hhAccountName
} from "@/entities/hh-account"

/** Options of the account column filter: default, all, then every account with its colour. */
export const accountFilterOptions = (
  accounts: ReadonlyArray<HhAccountRecord>,
  defaultAccountId: string | undefined,
  includeDefault = true
): ReadonlyArray<HeaderFilterOption> => {
  const defaultAccount = accounts.find((account) => account.id === defaultAccountId)
  return [
    ...(includeDefault
      ? [
          {
            value: DEFAULT_ACCOUNT,
            label: `По умолчанию${defaultAccount ? ` (${hhAccountName(defaultAccount)})` : ""}`,
            color: defaultAccount ? hhAccountColor(defaultAccount) : undefined
          }
        ]
      : []),
    { value: ALL_ACCOUNTS, label: "Все аккаунты" },
    ...accounts.map((account) => ({
      value: account.id,
      label: hhAccountName(account),
      color: hhAccountColor(account)
    }))
  ]
}
