import { REPEATED_FAILURE_STREAK } from "@otbor/domain"
import { humanizeError } from "@/entities/auto-apply/status"

/**
 * Пауза отправок аккаунта словами. Причина приходит строкой: старый сервер
 * знает только `captcha` и вообще не присылает `submitBlockDetail`, поэтому всё,
 * кроме `repeated_failure`, читается как капча.
 */
export interface SubmitPauseView {
  readonly kind: "captcha" | "repeated_failure"
  /** Заголовок блока: что случилось. */
  readonly title: string
  /** Одна строка для компактных мест (карточка на обзоре). */
  readonly summary: string
  /** Ошибка человеческими словами; `null` у капчи. */
  readonly humanError: string | null
  /** Исходный текст отказа для подсказки; `null`, если он совпадает с понятным или его нет. */
  readonly rawDetail: string | null
}

export const describeSubmitPause = (input: {
  readonly reason?: string | null | undefined
  readonly detail?: string | null | undefined
}): SubmitPauseView => {
  if (input.reason !== "repeated_failure") {
    return {
      kind: "captcha",
      title: "Пауза после капчи",
      summary: "hh просит капчу — отправки на паузе",
      humanError: null,
      rawDetail: null
    }
  }
  const human = humanizeError(input.detail)
  const raw = input.detail?.trim() ?? ""
  return {
    kind: "repeated_failure",
    title: `Отправки остановлены: ${REPEATED_FAILURE_STREAK} раз подряд одна и та же ошибка`,
    summary: human === null ? "отправки остановлены: одна и та же ошибка подряд" : `отправки остановлены: ${human}`,
    humanError: human,
    rawDetail: raw === "" || raw === human ? null : raw
  }
}

/** «ЧЧ:ММ» (с датой, если не сегодня): когда пауза снимется сама. */
export const retryTimeText = (iso: string | null | undefined, now: Date = new Date()): string | null => {
  if (iso === null || iso === undefined) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const time = at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  return at.toDateString() === now.toDateString()
    ? time
    : `${time}, ${at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`
}
