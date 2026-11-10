/** Выбранная пара «аккаунт hh + резюме». Резюме null: строка аккаунта целиком. */
export interface FilterTarget {
  readonly accountId: string
  readonly resumeId: string | null
}

interface AccountLike {
  readonly id: string
  readonly isDefault: boolean
}

interface ResumeLike {
  readonly id: string
  readonly hhAccountId: string
}

/**
 * Приводит желаемый выбор (из адреса или от пользователя) к существующему:
 * неизвестный аккаунт заменяется аккаунтом по умолчанию, а резюме чужого
 * аккаунта сбрасывается на «все резюме». Пока резюме не загрузились, резюме
 * не трогаем, чтобы не потерять выбор из адреса.
 */
export const resolveTarget = (
  accounts: ReadonlyArray<AccountLike>,
  resumes: ReadonlyArray<ResumeLike>,
  resumesLoaded: boolean,
  wanted: FilterTarget
): FilterTarget => {
  if (accounts.length === 0) return wanted
  const account =
    accounts.find((item) => item.id === wanted.accountId) ??
    accounts.find((item) => item.isDefault) ??
    accounts[0]!
  if (wanted.resumeId === null) return { accountId: account.id, resumeId: null }
  if (!resumesLoaded) return { accountId: account.id, resumeId: wanted.resumeId }
  const belongs = resumes.some((item) => item.id === wanted.resumeId && item.hhAccountId === account.id)
  return { accountId: account.id, resumeId: belongs ? wanted.resumeId : null }
}

/** Строка запроса `?account=&resume=`; пустая, пока аккаунт не выбран. */
export const targetQuery = (target: FilterTarget): string => {
  if (target.accountId === "") return ""
  const params = new URLSearchParams({ account: target.accountId })
  if (target.resumeId !== null) params.set("resume", target.resumeId)
  return `?${params.toString()}`
}

/** Путь страницы с тем же выбором: ссылки между страницами сохраняют аккаунт и резюме. */
export const pathWithTarget = (path: string, target: FilterTarget): string => `${path}${targetQuery(target)}`

/** Выбор из строки запроса адреса. */
export const targetFromSearch = (search: string): FilterTarget => {
  const params = new URLSearchParams(search)
  const resume = params.get("resume")
  return { accountId: params.get("account") ?? "", resumeId: resume === null || resume === "" ? null : resume }
}

/** Адрес с обновлёнными `account` и `resume`; остальные параметры не меняются. */
export const searchWithTarget = (search: string, target: FilterTarget): string => {
  const params = new URLSearchParams(search)
  params.delete("account")
  params.delete("resume")
  if (target.accountId !== "") {
    params.set("account", target.accountId)
    if (target.resumeId !== null) params.set("resume", target.resumeId)
  }
  const next = params.toString()
  return next === "" ? "" : `?${next}`
}
