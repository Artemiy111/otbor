import type { AutoApplyStage } from "@otbor/contract"
import { applicationStatus, formatDate, type StatusTone } from "@/shared/lib"

/**
 * Единый словарь состояния отклика для человека. Состояние (`state`), этап
 * автоотклика (`stage`), причина остановки и время повтора сливаются в один
 * статус: страница откликов, страница отклика и сводка автооткликов говорят
 * одними словами и красят одинаково. Ответ работодателя (hh) сюда не входит,
 * он описан отдельно в `employerResponse`.
 */

/** Откуда смотреть на отклик: что делать оператору и где он в процессе. */
export type ApplicationPhase =
  /** Ждёт человека: черновик, остановка, ошибка. */
  | "attention"
  /** Идёт сам: готовится, в очереди, отправляется. */
  | "active"
  | "sent"
  | "skipped"

export interface ApplicationStatusInput {
  readonly state: string
  readonly autoRun?: "drafts" | "auto" | null
  readonly blockedReason?: string | null
  readonly retryAt?: string | null
}

export interface HumanStatus {
  readonly label: string
  readonly tone: StatusTone
  /** Вторая строка: причина или время («форма не прочитана», «до 14:30»). */
  readonly detail: string | null
  /** Метка и подробность одной строкой: «Нужно ваше участие: форма не прочитана». */
  readonly text: string
  readonly phase: ApplicationPhase
  /** Откликом занят раннер: страница обновляет такие строки сама. */
  readonly moving: boolean
}

/** Короткая причина остановки для бейджа; полные фразы лежат в `BLOCKED_REASON_LABELS`. */
const SHORT_REASONS: Readonly<Record<string, string>> = {
  no_resume: "не выбрано резюме",
  form_unreadable: "форма не распознана",
  form_gone: "вакансия закрыта",
  form_read_failed: "форма не прочитана",
  form_hint_blocked: "ответ требует проверки",
  kit_refused: "письмо не прошло проверку",
  writing_failed: "письмо не написано",
  daily_cap: "дневной лимит",
  captcha: "hh спросил капчу",
  submit_not_sent: "отклик не ушёл",
  reconcile_unclear: "неясно, ушёл ли отклик",
  operator: "нужно решение человека"
}

export const shortReasonLabel = (code: string | null | undefined): string | null =>
  code === null || code === undefined || code === "" ? null : (SHORT_REASONS[code] ?? code)

/** Что оператору делать с остановившимся откликом: одна фраза на причину. */
const REASON_ADVICE: Readonly<Record<string, string>> = {
  no_resume: "Выберите резюме для откликов на странице аккаунта и нажмите «Повторить».",
  form_unreadable: "hh показал форму, которую мы не разобрали. Откройте вакансию на hh.ru и откликнитесь там вручную или пропустите.",
  form_gone: "Вакансия больше не принимает отклики. Её можно пропустить.",
  form_read_failed: "Форму не получилось прочитать. Нажмите «Повторить»: форма прочитается заново.",
  form_hint_blocked: "Один из ответов не прошёл проверку. Откройте вакансию, исправьте ответ и отправьте отклик.",
  kit_refused: "Письмо или ответы не прошли проверку. Исправьте их и отправьте отклик.",
  writing_failed: "Письмо не написалось. Нажмите «Повторить»: оно будет написано заново.",
  daily_cap: "Дневной лимит откликов исчерпан. Отправка продолжится сама, когда лимит освободится.",
  captcha: "hh попросил капчу. Нажмите «Повторить»: отклик пройдёт заново с распознаванием капчи.",
  submit_not_sent: "hh не принял отклик. Нажмите «Повторить» или пропустите.",
  reconcile_unclear: "Неизвестно, ушёл ли отклик. Проверьте раздел «Отклики» на hh.ru; если его нет, нажмите «Повторить».",
  operator: "Нужно ваше решение: отправьте отклик, повторите попытку или пропустите."
}

export const reasonAdvice = (code: string | null | undefined): string | null =>
  code === null || code === undefined || code === "" ? null : (REASON_ADVICE[code] ?? null)

/** Время повтора как «14:30» сегодня и «14:30, 12 ноября» в остальные дни. */
const clock = (iso: string, now: Date): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return formatDate(iso)
  const time = at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay ? time : `${time}, ${at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`
}

export const retryClock = clock

/** Этапы автоотклика в порядке процесса: подпись и тон. Единственный источник слов для этапов. */
export const AUTO_STAGE_STATUS: Readonly<
  Record<AutoApplyStage, { readonly label: string; readonly tone: StatusTone }>
> = {
  waiting: { label: "В очереди на подготовку", tone: "neutral" },
  blocked: { label: "Ждёт повтора", tone: "warning" },
  reading_form: { label: "Читаем форму", tone: "info" },
  writing: { label: "Пишем письмо", tone: "info" },
  kit_ready: { label: "Готов к отправке", tone: "info" },
  submitting: { label: "Отправляется", tone: "info" },
  submitted: { label: "Отправлен", tone: "success" },
  needs_human: { label: "Нужно ваше участие", tone: "warning" },
  failed: { label: "Ошибка", tone: "danger" }
}

const make = (
  label: string,
  tone: StatusTone,
  detail: string | null,
  phase: ApplicationPhase,
  moving = false
): HumanStatus => ({
  label,
  tone,
  detail,
  text: detail === null ? label : `${label}: ${detail}`,
  phase,
  moving
})

/**
 * Сливает состояние, этап и причину в один статус. `stage` известен только
 * для автооткликов в работе (его отдаёт прогресс автооткликов); без него
 * ожидающий отклик называется общим «Готовим отклик».
 */
export const humanStatus = (
  input: ApplicationStatusInput,
  stage: AutoApplyStage | null = null,
  now: Date = new Date()
): HumanStatus => {
  const reason = shortReasonLabel(input.blockedReason)
  switch (input.state) {
    case "draft":
      return make("Черновик", "neutral", "ждёт вашей отправки", "attention")
    case "preparing": {
      if (input.blockedReason === "daily_cap") {
        return make(
          input.retryAt ? `Ждёт лимита до ${clock(input.retryAt, now)}` : "Ждёт лимита",
          "neutral",
          null,
          "active",
          true
        )
      }
      if (input.blockedReason !== null && input.blockedReason !== undefined) {
        return make(
          "Повторим позже",
          "warning",
          input.retryAt ? `${reason}, в ${clock(input.retryAt, now)}` : reason,
          "active",
          true
        )
      }
      if (stage === "reading_form" || stage === "writing" || stage === "kit_ready" || stage === "waiting") {
        const meta = AUTO_STAGE_STATUS[stage]
        return make(meta.label, meta.tone, null, "active", true)
      }
      return make("Готовим отклик", "info", null, "active", true)
    }
    case "queued":
      return make("В очереди на отправку", "info", null, "active", true)
    case "submitting":
      return make("Отправляется", "info", null, "active", true)
    case "submitted":
      return make("Отправлен", "success", null, "sent")
    case "skipped":
      return make("Пропущен", "neutral", null, "skipped")
    case "needs_human":
      return make("Нужно ваше участие", "warning", reason, "attention")
    case "failed":
      return make("Ошибка", "danger", reason, "attention")
    default:
      return make(input.state, "neutral", null, "skipped")
  }
}

/** Этап автоотклика одним статусом: для сводки на странице автооткликов. */
export const stageStatus = (stage: AutoApplyStage): { readonly label: string; readonly tone: StatusTone } =>
  AUTO_STAGE_STATUS[stage]

/**
 * Ответ работодателя на отправленный отклик: отдельная колонка, не бейдж
 * состояния. `null`, пока откликов нет или hh ничего не сообщил.
 */
export const employerResponse = (application: {
  readonly state: string
  readonly hhStatus?: string | null
}): { readonly label: string; readonly tone: StatusTone } | null => {
  if (application.hhStatus === null || application.hhStatus === undefined || application.hhStatus === "") {
    return null
  }
  if (application.hhStatus === "RESPONSE") return { label: "Ждёт просмотра", tone: "neutral" }
  const status = applicationStatus({ state: application.state, hhStatus: application.hhStatus })
  return { label: status.label, tone: status.tone }
}

/** Режим отклика словами: вручную, черновики или авто. */
export const modeLabel = (autoRun: "drafts" | "auto" | null | undefined): string =>
  autoRun === "auto" ? "Авто" : autoRun === "drafts" ? "Черновики" : "Вручную"

export const modeTone = (autoRun: "drafts" | "auto" | null | undefined): "neutral" | "info" | "success" =>
  autoRun === "auto" ? "success" : autoRun === "drafts" ? "info" : "neutral"

/**
 * Последняя ошибка человеческими словами. Русский текст бэкенда остаётся как
 * есть, английские сообщения и коды сводятся к понятной фразе; сырой текст
 * показывается отдельно, в технических деталях.
 */
export const humanizeError = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null
  const text = raw.trim()
  if (text === "") return null
  if (/[а-яё]/i.test(text)) return text
  if (/captcha/i.test(text)) return "hh попросил капчу."
  if (/rate.?limit|too many|\b429\b/i.test(text)) return "hh ограничил частоту запросов."
  if (/timeout|timed out/i.test(text)) return "hh слишком долго не отвечал."
  if (/session|log.?in|logged out|unauthori[sz]ed|\b401\b/i.test(text)) {
    return "Сессия hh истекла или аккаунт разлогинен: войдите в аккаунт заново."
  }
  if (/archiv|not found|\b404\b|\bgone\b/i.test(text)) return "Вакансия недоступна на hh."
  if (/econn|enotfound|network|fetch failed|socket/i.test(text)) return "Нет связи с hh или с прокси."
  if (/form/i.test(text)) return "Форму отклика не получилось прочитать или разобрать."
  if (/letter|writ|inference|model/i.test(text)) return "Письмо не удалось написать."
  return "Обработка отклика завершилась сбоем. Подробности в технических деталях."
}
