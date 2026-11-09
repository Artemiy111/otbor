/**
 * Кнопка «Поднять в поиске» на странице резюме hh.ru.
 *
 * Чистые функции без браузера: харнесс отдаёт сюда то, что увидел в DOM
 * (текст и href кнопки), а решение «можно ли нажимать» принимается здесь и
 * проверяется тестами.
 *
 * На странице резюме есть две разные кнопки:
 * - `button[data-qa="resume-update-button"]` с подписью «Поднять в поиске»
 *   (между «в» и «поиске» стоит неразрывный пробел U+00A0) - настоящая кнопка;
 * - `a[data-qa="resumeservice-button__renewresume"]` с подписью «Поднимать
 *   автоматически» и ссылкой `/applicant-services/hhpro` - это предложение
 *   подписки. Её нельзя нажимать никогда.
 */

/** Настоящая кнопка подъёма. */
export const BUMP_BUTTON_SELECTOR = 'button[data-qa="resume-update-button"]'

/** Кнопка-реклама подписки: только читается, не нажимается. */
export const BUMP_PAYWALL_SELECTOR = '[data-qa="resumeservice-button__renewresume"]'

/** Подпись, по которой кнопка признаётся рабочей. */
export const BUMP_LABEL = "Поднять в поиске"

/** Любая ссылка на подписку делает кнопку непригодной для нажатия. */
const PAYWALL_HREF = "/applicant-services/hhpro"

/** Что харнесс увидел у кнопки. */
export interface BumpButtonView {
  readonly label: string
  readonly href: string | null
  /** Атрибут `disabled` или `aria-disabled="true"`. */
  readonly disabled?: boolean
}

/**
 * Приводит текст к виду для сравнения: неразрывные и узкие пробелы, переводы
 * строк и повторы пробелов превращаются в один обычный пробел.
 */
export const normalizeBumpText = (text: string): string =>
  text.replace(/\u200b/g, "").replace(/[\s\u00a0\u202f\u2009]+/g, " ").trim()

export type BumpDecision =
  | { readonly _tag: "click" }
  | { readonly _tag: "unavailable"; readonly label: string; readonly reason: string }

/**
 * Решает, нажимать ли кнопку. Нажатие разрешено, только если есть настоящая
 * кнопка, её подпись содержит «Поднять в поиске», ссылка (если есть) не ведёт
 * на подписку и кнопка не отключена. Всё остальное - «недоступно»: hh даёт
 * поднимать резюме раз в 4 часа, так что это обычный исход, а не ошибка.
 * Кнопка-реклама учитывается только в тексте причины.
 */
export const decideBump = (
  button: BumpButtonView | null,
  paywall: BumpButtonView | null = null
): BumpDecision => {
  if (button === null) {
    const seen = paywall === null ? "no bump button on the page" : normalizeBumpText(paywall.label)
    return { _tag: "unavailable", label: seen, reason: "no bump button" }
  }
  const label = normalizeBumpText(button.label)
  if (!label.toLowerCase().includes(BUMP_LABEL.toLowerCase())) {
    return { _tag: "unavailable", label, reason: "the button is not the bump button" }
  }
  if (button.href !== null && button.href.includes(PAYWALL_HREF)) {
    return { _tag: "unavailable", label, reason: "the button leads to a subscription offer" }
  }
  if (button.disabled === true) {
    return { _tag: "unavailable", label, reason: "the button is disabled" }
  }
  return { _tag: "click" }
}

/**
 * Строка «Последнее — 08 ноября в 19:15» из карточки «Поднятие резюме». Дата
 * приходит без года и часового пояса, поэтому это только свидетельство
 * изменения, а не момент времени. `null`, если строки нет.
 */
export const parseLastBump = (text: string): string | null => {
  const match = /Последнее\s*[—–-]\s*([^\n\r]+)/.exec(text)
  if (match === null) return null
  const value = normalizeBumpText(match[1] ?? "")
  return value === "" ? null : value
}
