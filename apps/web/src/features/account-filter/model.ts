import type { HhAccountRecord } from "@otbor/contract"
import type { HeaderFilterOption } from "@/shared/ui"
import {
  ALL_ACCOUNTS,
  DEFAULT_ACCOUNT,
  hhAccountColor,
  hhAccountName
} from "@/entities/hh-account"

/**
 * Options of the account column filter: «как в шапке» (фильтр «Показывать» из
 * шапки; `defaultAccountId` пуст, когда там выбраны все аккаунты), all, then every account.
 */
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
            label: `Как в шапке (${defaultAccount ? hhAccountName(defaultAccount) : "все аккаунты"})`,
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
