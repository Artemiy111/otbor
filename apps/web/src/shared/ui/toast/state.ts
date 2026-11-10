import { readonly, shallowReactive } from "vue"

/** Тон уведомления: те же слова, что у бейджей и карточек. */
export type ToastTone = "success" | "info" | "warning" | "danger"

export interface ToastAction {
  readonly label: string
  /** Ссылка внутри приложения; роутер открывает её без перезагрузки. */
  readonly href?: string
  readonly onClick?: () => void
}

export interface ToastOptions {
  readonly description?: string
  /** Через сколько миллисекунд закрыть само; `null` - только вручную. */
  readonly duration?: number | null
  readonly action?: ToastAction
  /** Одинаковый ключ заменяет прошлое уведомление, а не плодит копии. */
  readonly key?: string
}

export interface ToastMessage extends ToastOptions {
  readonly id: number
  readonly tone: ToastTone
  readonly title: string
}

/** Сколько уведомлений видно одновременно: старые вытесняются. */
export const MAX_TOASTS = 4

/** Успех и сведения гаснут сами; предупреждения живут дольше, ошибки остаются до закрытия. */
export const defaultDuration = (tone: ToastTone): number | null =>
  tone === "danger" ? null : tone === "warning" ? 9_000 : 5_000

let counter = 0
const items = shallowReactive<Array<ToastMessage>>([])

const dismiss = (id: number): void => {
  const index = items.findIndex((item) => item.id === id)
  if (index >= 0) items.splice(index, 1)
}

const push = (tone: ToastTone, title: string, options: ToastOptions = {}): number => {
  if (options.key !== undefined) {
    const same = items.find((item) => item.key === options.key)
    if (same !== undefined) dismiss(same.id)
  }
  counter += 1
  const id = counter
  items.push({ ...options, id, tone, title })
  while (items.length > MAX_TOASTS) items.shift()
  return id
}

/**
 * Единственная система уведомлений: страницы зовут `useToast()` и не рисуют
 * свои «Готово / Не удалось». Контейнер монтируется один раз в оболочке.
 */
export const useToast = () => ({
  show: push,
  success: (title: string, options?: ToastOptions) => push("success", title, options),
  info: (title: string, options?: ToastOptions) => push("info", title, options),
  warning: (title: string, options?: ToastOptions) => push("warning", title, options),
  error: (title: string, options?: ToastOptions) => push("danger", title, options),
  dismiss,
  clear: () => items.splice(0, items.length)
})

/** Текущие уведомления для контейнера. */
export const toastItems = readonly(items) as ReadonlyArray<ToastMessage>
