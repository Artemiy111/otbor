import type { EmployerBlacklistView, HhAccountRecord } from "@otbor/contract"
import { hhAccountName } from "@/entities/hh-account"
import type { HeaderFilterOption } from "@/shared/ui"

/** Blacklist visibility: hidden rows stay in the corpus, the toggle only changes the view. */
export const blacklistVisibilityOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "hide", label: "Скрыть заблокированные" },
  { value: "show", label: "Показать заблокированные" }
]

const ACCOUNT_PREFIX = "account:"

/** Companies page: who blocked the company, not just whether it is blocked. */
export const companyBlacklistOptions = (
  accounts: ReadonlyArray<HhAccountRecord>
): ReadonlyArray<HeaderFilterOption> => [
  { value: "hide", label: "Скрыть заблокированные" },
  { value: "all", label: "Показать все" },
  { value: "only", label: "Только заблокированные" },
  { value: "app", label: "Заблокированы в приложении" },
  ...accounts.map((account) => ({
    value: `${ACCOUNT_PREFIX}${account.id}`,
    label: `Заблокированы: ${hhAccountName(account)}`
  }))
]

export const parseCompanyBlacklistFilter = (
  value: string
): { blacklistView: EmployerBlacklistView; blockedByAccountId?: string } =>
  value.startsWith(ACCOUNT_PREFIX)
    ? { blacklistView: "account", blockedByAccountId: value.slice(ACCOUNT_PREFIX.length) }
    : { blacklistView: value as EmployerBlacklistView }
