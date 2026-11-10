import type { HhAccountRecord, OverviewAccount } from "@otbor/contract"

/** Тон бейджа состояния; совпадает с `StatusTone` из shared/lib. */
export type StateTone = "success" | "warning" | "danger" | "neutral"

export interface LoginView {
  readonly tone: StateTone
  /** Коротко: что с входом. */
  readonly label: string
  /** Одно-два предложения: что именно известно и что это значит. */
  readonly detail: string
  /** Что сделать; `null`, когда делать нечего. */
  readonly advice: string | null
  /** Команда для терминала, если вход надо повторить. */
  readonly command: string | null
}

/** Команда входа: привязывает сессию к этому аккаунту, а не создаёт новый. */
export const loginCommand = (accountId: string): string => `otbor hh login --account ${accountId}`

/** Состояние входа в hh.ru словами, с последней удачной проверкой и тем, что делать. */
export const describeLogin = (
  account: Pick<HhAccountRecord, "id" | "session">,
  formatWhen: (iso: string) => string
): LoginView => {
  const session = account.session
  const command = loginCommand(account.id)
  if (session == null) {
    return {
      tone: "neutral",
      label: "Вход не выполнен",
      detail: "Для этого аккаунта ещё не сохранена сессия hh.ru.",
      advice: "Выполните в терминале команду ниже и войдите в hh.ru в открывшемся окне.",
      command
    }
  }
  const checked = session.lastOkAt === null ? "Удачной проверки ещё не было." : `Последняя удачная проверка: ${formatWhen(session.lastOkAt)}.`
  const error = session.lastError === null || session.lastError.trim() === "" ? "" : ` Ошибка: ${session.lastError.trim()}`
  if (session.state === "ok") {
    return { tone: "success", label: "Вход выполнен", detail: checked, advice: null, command: null }
  }
  if (session.state === "expired") {
    return {
      tone: "danger",
      label: "Сессия истекла",
      detail: `${checked}${error}`,
      advice: "Выполните в терминале команду ниже и войдите заново. Отклики с этого аккаунта пока не уйдут.",
      command
    }
  }
  return {
    tone: "danger",
    label: "hh.ru не пускает в аккаунт",
    detail: `${checked}${error}`,
    advice: "Подождите и войдите заново командой ниже. Если не помогает, откройте hh.ru в обычном браузере и проверьте аккаунт.",
    command
  }
}

export interface UsageView {
  readonly used: number
  readonly limit: number
  /** Доля от 0 до 100 для полоски. */
  readonly percent: number
  readonly tone: StateTone
  readonly exhausted: boolean
}

/** Расход дневного лимита откликов; тон растёт по мере приближения к лимиту. */
export const describeUsage = (usage: Pick<OverviewAccount["usage"], "used" | "limit">): UsageView => {
  const limit = Math.max(usage.limit, 0)
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((usage.used / limit) * 100))
  const exhausted = limit > 0 && usage.used >= limit
  return {
    used: usage.used,
    limit,
    percent,
    exhausted,
    tone: exhausted ? "danger" : percent >= 80 ? "warning" : "success"
  }
}

/** Сколько минут до повтора после капчи; `null`, если срок неизвестен или прошёл. */
export const minutesUntil = (iso: string | null, now: number): number | null => {
  if (iso === null) return null
  const diff = Date.parse(iso) - now
  return Number.isNaN(diff) || diff <= 0 ? null : Math.ceil(diff / 60_000)
}
