import type { BlockedReason, CrawlSchedule, Health, Overview, ProxyStatus } from "@otbor/contract"
import { formatAge, formatNumber } from "@/shared/lib/format"
import { countWord, plural, type PluralForms } from "@/shared/lib/plural"
import { jobStageLabel, scheduleKindLabel } from "@/shared/lib/status"
import { agoText, inText, olderThan } from "./time"
import { plainError } from "./plain"

export type AttentionTone = "danger" | "warning" | "info"

export type AttentionIcon =
  | "server"
  | "database"
  | "browser"
  | "session"
  | "captcha"
  | "application"
  | "draft"
  | "jobs"
  | "schedule"
  | "inbox"
  | "limit"
  | "proxy"
  | "model"
  | "stalled"

export type AttentionAction =
  | { readonly kind: "link"; readonly label: string; readonly href: string }
  /** Кнопка «Повторить сейчас»: повторяет заявки аккаунта, остановленные капчей. */
  | {
      readonly kind: "retry-captcha"
      readonly label: string
      readonly accountId: string
      readonly href: string
    }

export interface AttentionItem {
  readonly id: string
  readonly tone: AttentionTone
  readonly icon: AttentionIcon
  readonly title: string
  /** Вторая строка: возраст, время повтора, причина. */
  readonly detail: string | null
  readonly action: AttentionAction
  /** Под строкой можно раскрыть подсказку «как запустить» (нет исполнителя). */
  readonly guide?: "executor"
  /** Порядок внутри тона: меньше — выше. */
  readonly weight: number
  /** Сколько сущностей за строкой; при равном весе большая группа выше. */
  readonly count: number
}

export interface AttentionInput {
  readonly overview: Overview | undefined
  readonly health: Health | undefined
  /** Запрос здоровья упал: сервер не отвечает. */
  readonly healthFailed: boolean
  readonly schedules: ReadonlyArray<CrawlSchedule> | undefined
  readonly proxy: ProxyStatus | undefined
  /** Момент расчёта, мс; передаётся снаружи, чтобы функции были чистыми. */
  readonly now: number
}

export const APPLICATION_FORMS: PluralForms = ["отклик", "отклика", "откликов"]
export const DIALOG_FORMS: PluralForms = ["диалог", "диалога", "диалогов"]
export const DRAFT_FORMS: PluralForms = ["черновик", "черновика", "черновиков"]
export const TASK_FORMS: PluralForms = ["задача", "задачи", "задач"]

const TONE_RANK: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2 }

/** Что случилось с заявками: короткая фраза после двоеточия. */
const REASON_PHRASE: Record<BlockedReason, string> = {
  no_resume: "не выбрано резюме",
  form_unreadable: "форма отклика не распознана",
  form_gone: "вакансия больше не принимает отклики",
  form_read_failed: "форму не удалось прочитать",
  form_hint_blocked: "подсказка к ответу заблокирована",
  kit_refused: "письмо или ответы не прошли проверку",
  writing_failed: "письмо не удалось написать",
  daily_cap: "достигнут дневной лимит",
  captcha: "hh попросил капчу",
  submit_not_sent: "отклик не дошёл до hh",
  reconcile_unclear: "не ясно, ушёл ли отклик",
  operator: "нужно решение человека"
}

export const reasonPhrase = (reason: BlockedReason | null, state: "needs_human" | "failed"): string =>
  reason === null
    ? state === "failed"
      ? "ошибка без пояснения"
      : "нужно ваше решение"
    : REASON_PHRASE[reason]

const oldestDetail = (iso: string | null, now: number): string | null => {
  const ago = agoText(iso, now)
  return ago === null ? null : `самое старое — ${ago}`
}

/** Названия через запятую; хвост сворачивается в «и ещё N». */
export const joinNames = (names: ReadonlyArray<string>, max = 3): string => {
  if (names.length <= max) return names.join(", ")
  return `${names.slice(0, max).join(", ")} и ещё ${names.length - max}`
}

/** Аккаунты, у которых хотя бы одна строка в режиме «авто». */
export const autoAccounts = (overview: Overview): ReadonlyArray<Overview["accounts"][number]> =>
  overview.accounts.filter((account) => account.autoModes.some((mode) => mode.autoMode === "auto"))

const isPaused = (account: Overview["accounts"][number], now: number): boolean =>
  account.submitBlockedAt !== null &&
  (account.submitRetryAt === null || Date.parse(account.submitRetryAt) > now - 60_000)

export const browserOnline = (health: Health | undefined): boolean | null =>
  health?.harnesses === undefined
    ? null
    : health.harnesses.some((harness) => harness.online && harness.kinds.includes("browser"))

const searchName = (schedule: CrawlSchedule): string => {
  const base = scheduleKindLabel(schedule.kind)
  if (schedule.kind !== "search") return base
  try {
    const text = new URL(schedule.targetId).searchParams.get("text")
    return text === null || text === "" ? base : `${base} «${text}»`
  } catch {
    return base
  }
}

/** Всё, что требует внимания человека, по убыванию важности. */
export const buildAttention = (input: AttentionInput): ReadonlyArray<AttentionItem> => {
  const { overview, health, healthFailed, schedules, proxy, now } = input
  const items: AttentionItem[] = []
  const push = (item: Omit<AttentionItem, "count"> & { count?: number }) => items.push({ count: 1, ...item })

  if (healthFailed) {
    push({
      id: "server-down",
      tone: "danger",
      icon: "server",
      title: "Сервер не отвечает",
      detail: "Данные ниже могут быть устаревшими. Страница обновится, когда сервер вернётся.",
      action: { kind: "link", label: "Проверить", href: "/health" },
      weight: 0
    })
  }

  if (health !== undefined) {
    if (!health.database) {
      push({
        id: "db-down",
        tone: "danger",
        icon: "database",
        title: "База данных недоступна",
        detail: "Пока она не вернётся, отклики и поиск не работают.",
        action: { kind: "link", label: "Проверить", href: "/health" },
        weight: 1
      })
    }
    if (browserOnline(health) === false) {
      const pending = overview?.jobs.pending.reduce((sum, row) => sum + row.count, 0) ?? 0
      push({
        id: "no-executor",
        tone: pending > 0 ? "danger" : "warning",
        icon: "browser",
        title: "Исполнитель браузера не подключён",
        detail:
          pending > 0
            ? `Отклики не отправляются: в очереди ${countWord(pending, TASK_FORMS)}.`
            : "Без него отклики не отправляются и формы не читаются.",
        action: { kind: "link", label: "Проверить", href: "/health" },
        guide: "executor",
        weight: 2
      })
    }
    if (health.systemOne !== undefined && !health.systemOne.reachable) {
      push({
        id: "model-down",
        tone: "info",
        icon: "model",
        title: "Модель анализа не отвечает",
        detail: "Вакансии пока оцениваются только по правилам.",
        action: { kind: "link", label: "Проверить", href: "/health" },
        weight: 56
      })
    }
  }

  if (proxy?.configured === true && proxy.engine !== null) {
    const engine = proxy.engine
    if (!engine.reachable) {
      push({
        id: "proxy-down",
        tone: "warning",
        icon: "proxy",
        title: "Прокси не отвечает",
        detail: "Запросы к hh могут идти напрямую или не проходить.",
        action: { kind: "link", label: "Открыть настройки", href: "/settings" },
        weight: 54
      })
    } else if (engine.checked > 0 && engine.alive === 0) {
      push({
        id: "proxy-dead",
        tone: "warning",
        icon: "proxy",
        title: "Ни один прокси-узел не отвечает",
        detail: `Проверено узлов: ${engine.checked}.`,
        action: { kind: "link", label: "Открыть настройки", href: "/settings" },
        weight: 54
      })
    }
  }

  if (overview !== undefined) {
    for (const account of overview.accounts) {
      if (account.session === "expired" || account.session === "blocked") {
        const reason = plainError(account.sessionError)
        push({
          id: `session-${account.id}`,
          tone: "danger",
          icon: "session",
          title:
            account.session === "blocked"
              ? `hh заблокировал вход: ${account.name}`
              : `Вход в hh истёк: ${account.name}`,
          detail: reason ?? "Войдите в аккаунт заново, иначе отклики с него не уйдут.",
          action: { kind: "link", label: "К аккаунтам", href: "/accounts" },
          weight: 10
        })
      } else if (isPaused(account, now)) {
        const retry = inText(account.submitRetryAt, now)
        push({
          id: `captcha-${account.id}`,
          tone: "warning",
          icon: "captcha",
          title: `hh просит капчу: ${account.name}`,
          detail:
            retry === null
              ? "Отправки с аккаунта на паузе."
              : `Отправки с аккаунта на паузе, система попробует снова ${retry}.`,
          action: { kind: "retry-captcha", label: "Повторить сейчас", accountId: account.id, href: "/accounts" },
          weight: 11
        })
      }
      if (account.usage.limit > 0 && account.usage.remaining === 0) {
        push({
          id: `limit-${account.id}`,
          tone: "info",
          icon: "limit",
          title: `Дневной лимит исчерпан: ${account.name}`,
          detail: `Отправлено ${formatNumber(account.usage.used)} из ${formatNumber(account.usage.limit)}; лимит освобождается постепенно.`,
          action: { kind: "link", label: "Настроить", href: "/auto-apply" },
          weight: 85
        })
      }
    }

    // Самая старая последняя отправка среди автоаккаунтов без паузы: тихая остановка.
    const working = autoAccounts(overview).filter((account) => account.session === "ok" && !isPaused(account, now))
    const pendingSubmits = overview.jobs.pending.find((row) => row.stage === "submit")?.count ?? 0
    const runningSubmits = overview.jobs.running.find((row) => row.stage === "submit")?.count ?? 0
    if (working.length > 0 && pendingSubmits > 0 && runningSubmits === 0) {
      const lastSent = working
        .map((account) => account.lastSentAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1)
      const roomLeft = working.some((account) => account.usage.remaining > 0)
      if (roomLeft && lastSent !== undefined && olderThan(lastSent, now, 2 * 3600)) {
        push({
          id: "stalled",
          tone: "warning",
          icon: "stalled",
          title: "Давно не было отправок",
          detail: `Последний отклик ушёл ${agoText(lastSent, now)}, хотя в очереди ${countWord(pendingSubmits, TASK_FORMS)}.`,
          action: { kind: "link", label: "Открыть очередь", href: "/queue" },
          weight: 40
        })
      }
    }

    for (const group of overview.applications.needsAttention) {
      if (group.count <= 0) continue
      const failed = group.state === "failed"
      push({
        id: `apps-${group.state}-${group.reason ?? "none"}`,
        tone: failed ? "danger" : "warning",
        icon: "application",
        title: `${countWord(group.count, APPLICATION_FORMS)}: ${reasonPhrase(group.reason, group.state)}`,
        detail: oldestDetail(group.oldestAt, now),
        action: {
          kind: "link",
          label: failed ? "Разобрать" : "Открыть",
          href: `/applications?state=${group.state}`
        },
        weight: failed ? 20 : 30,
        count: group.count
      })
    }

    if (overview.applications.draftsToReview > 0) {
      const count = overview.applications.draftsToReview
      push({
        id: "drafts",
        tone: "info",
        icon: "draft",
        title: `${countWord(count, DRAFT_FORMS)} ${plural(count, ["ждёт", "ждут", "ждут"])} проверки`,
        detail: "Проверьте письмо и отправьте или пропустите.",
        action: { kind: "link", label: "Проверить", href: "/applications?state=draft" },
        weight: 70,
        count
      })
    }

    const reconcile = overview.jobs.stuck.filter((row) => row.status === "needs_reconcile")
    if (reconcile.length > 0) {
      const count = reconcile.reduce((sum, row) => sum + row.count, 0)
      const oldest = reconcile.map((row) => row.oldestAt).filter((v): v is string => v !== null).sort()[0] ?? null
      push({
        id: "reconcile",
        tone: "warning",
        icon: "jobs",
        title: `${countWord(count, APPLICATION_FORMS)}: не ясно, ушёл ли отклик — идёт сверка`,
        detail: oldestDetail(oldest, now),
        action: { kind: "link", label: "Открыть очередь", href: "/queue" },
        weight: 25,
        count
      })
    }

    const halted = overview.jobs.stuck.filter((row) => row.status === "needs_human")
    const broken = overview.jobs.stuck.filter((row) => row.status === "dead" || row.status === "failed")
    if (halted.length + broken.length > 0) {
      const haltedCount = halted.reduce((sum, row) => sum + row.count, 0)
      const brokenCount = broken.reduce((sum, row) => sum + row.count, 0)
      const parts: string[] = []
      if (haltedCount > 0) parts.push(`${countWord(haltedCount, TASK_FORMS)} ждут человека`)
      if (brokenCount > 0) parts.push(`${countWord(brokenCount, TASK_FORMS)} закончились сбоем за сутки`)
      const stages = [...new Set([...halted, ...broken].map((row) => jobStageLabel(row.stage).toLowerCase()))]
      push({
        id: "jobs-stuck",
        tone: "warning",
        icon: "jobs",
        title: `Фоновые задачи: ${parts.join(", ")}`,
        detail: `Этапы: ${joinNames(stages, 4)}.`,
        action: { kind: "link", label: "Открыть очередь", href: "/queue" },
        weight: 50,
        count: haltedCount + brokenCount
      })
    }

    if (overview.inbox.unreadConversations > 0) {
      const count = overview.inbox.unreadConversations
      push({
        id: "inbox",
        tone: "info",
        icon: "inbox",
        title: `${countWord(count, ["непрочитанный диалог", "непрочитанных диалога", "непрочитанных диалогов"])}`,
        detail: agoText(overview.inbox.lastInboundAt, now) === null ? null : `последнее сообщение — ${agoText(overview.inbox.lastInboundAt, now)}`,
        action: { kind: "link", label: "Прочитать", href: "/contacts" },
        weight: 80,
        count
      })
    }
  }

  if (schedules !== undefined) {
    const active = schedules.filter((schedule) => schedule.enabled)
    const failing = active.filter((schedule) => schedule.lastError !== null && schedule.lastError !== "")
    if (failing.length > 0) {
      const reasons = [...new Set(failing.map((schedule) => plainError(schedule.lastError)).filter((v) => v !== null))]
      push({
        id: "schedules-error",
        tone: "warning",
        icon: "schedule",
        title: `${countWord(failing.length, ["расписание", "расписания", "расписаний"])} с ошибкой: ${joinNames([...new Set(failing.map(searchName))])}`,
        detail: reasons.length > 0 ? `Последний запуск не удался: ${reasons.join(", ")}.` : "Последний запуск не удался.",
        action: { kind: "link", label: "К расписаниям", href: "/schedules" },
        weight: 60,
        count: failing.length
      })
    }
    const overdue = active.filter((schedule) => {
      if (schedule.nextRunAt === null) return false
      const lateMs = now - Date.parse(schedule.nextRunAt)
      return lateMs > Math.max(15 * 60_000, schedule.intervalMinutes * 60_000)
    })
    if (overdue.length > 0) {
      const late = Math.max(...overdue.map((schedule) => (now - Date.parse(schedule.nextRunAt!)) / 1000))
      push({
        id: "schedules-overdue",
        tone: "warning",
        icon: "schedule",
        title: `Не запускалось вовремя: ${joinNames([...new Set(overdue.map(searchName))])}`,
        detail: `Опоздание — до ${formatAge(late)}. Возможно, остановлен сервер.`,
        action: { kind: "link", label: "К расписаниям", href: "/schedules" },
        weight: 61,
        count: overdue.length
      })
    }
    if (schedules.length > 0 && active.length === 0) {
      push({
        id: "schedules-off",
        tone: "info",
        icon: "schedule",
        title: "Все расписания выключены",
        detail: "Новые вакансии не собираются, пока вы не включите хотя бы одно.",
        action: { kind: "link", label: "К расписаниям", href: "/schedules" },
        weight: 65
      })
    }
  }

  return items.sort(
    (a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.weight - b.weight || b.count - a.count
  )
}
