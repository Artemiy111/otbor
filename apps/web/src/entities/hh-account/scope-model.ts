/** Значение фильтра шапки «все аккаунты». */
export const VIEW_ALL = "all"

interface AccountLike {
  readonly id: string
  readonly isDefault: boolean
}

export interface AccountView {
  /** Основной аккаунт с сервера (`isDefault`), иначе первый. Меняется только на странице аккаунтов. */
  readonly serverDefaultId: string | undefined
  /** Что показывает фильтр шапки: `"all"` или id существующего аккаунта. */
  readonly viewId: string
  /** Аккаунт, на который смотрят списки; `undefined`, если выбраны все. */
  readonly viewAccountId: string | undefined
  /** Конкретный аккаунт для действий: выбранный в шапке, иначе основной. */
  readonly actingAccountId: string | undefined
}

/**
 * Сводит три значения к одному выбору. Основной аккаунт приходит с сервера и
 * не зависит от браузера. Фильтр шапки хранится в браузере; пока он не выбран
 * или аккаунт пропал, фильтр совпадает с основным аккаунтом.
 */
export const resolveAccountView = (accounts: ReadonlyArray<AccountLike>, stored: string): AccountView => {
  const serverDefaultId = (accounts.find((account) => account.isDefault) ?? accounts[0])?.id
  const viewId =
    stored === VIEW_ALL
      ? VIEW_ALL
      : accounts.some((account) => account.id === stored)
        ? stored
        : (serverDefaultId ?? VIEW_ALL)
  const viewAccountId = viewId === VIEW_ALL ? undefined : viewId
  return { serverDefaultId, viewId, viewAccountId, actingAccountId: viewAccountId ?? serverDefaultId }
}
