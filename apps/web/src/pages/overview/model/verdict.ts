import type { Overview } from "@otbor/contract"
import type { StatusTone } from "@/shared/lib/status"
import { formatNumber } from "@/shared/lib/format"
import { countWord, type PluralForms } from "@/shared/lib/plural"
import { autoAccounts, browserOnline, joinNames, type AttentionInput, type AttentionItem } from "./attention"

export type VerdictGlyph = "ok" | "attention" | "stop" | "idle" | "loading"

export interface Verdict {
  readonly tone: StatusTone
  readonly glyph: VerdictGlyph
  /** Одно предложение: работает ли система и нужен ли человек. */
  readonly headline: string
  readonly detail: string | null
}

const QUESTION_FORMS: PluralForms = ["вопрос", "вопроса", "вопросов"]
const DRAFT_FORMS: PluralForms = ["черновик", "черновика", "черновиков"]
const DIALOG_FORMS: PluralForms = ["диалог", "диалога", "диалогов"]

/** «Автоотклики идут: сегодня отправлено 37 из 200.» */
export const workingSentence = (overview: Overview): string => {
  const accounts = autoAccounts(overview)
  const limit = accounts.reduce((sum, account) => sum + account.usage.limit, 0)
  const sent = overview.applications.sentToday
  if (sent === 0) return "Автоотклики включены, сегодня пока ничего не отправлено."
  return limit > 0
    ? `Автоотклики идут: за сутки отправлено ${formatNumber(sent)} из ${formatNumber(limit)}.`
    : `Автоотклики идут: за сутки отправлено ${formatNumber(sent)}.`
}

/** Что ждёт человека, но не мешает работе: «37 черновиков и 1 диалог». */
const waitingSentence = (overview: Overview): string | null => {
  const parts: string[] = []
  if (overview.applications.draftsToReview > 0) {
    parts.push(countWord(overview.applications.draftsToReview, DRAFT_FORMS))
  }
  if (overview.inbox.unreadConversations > 0) {
    parts.push(`${countWord(overview.inbox.unreadConversations, DIALOG_FORMS)} без ответа`)
  }
  return parts.length === 0 ? null : `Ждут вас: ${parts.join(" и ")}.`
}

const join = (...parts: ReadonlyArray<string | null>): string | null => {
  const text = parts.filter((part): part is string => part !== null && part !== "").join(" ")
  return text === "" ? null : text
}

/** Общий вердикт по всему, что известно о системе. Тон следует худшей открытой проблеме. */
export const buildVerdict = (
  input: AttentionInput & {
    readonly items: ReadonlyArray<AttentionItem>
    /** Запрос обзора упал, а прежних данных нет. */
    readonly overviewFailed?: boolean
  }
): Verdict => {
  const { overview, health, healthFailed, items, now } = input

  if (healthFailed) {
    return {
      tone: "danger",
      glyph: "stop",
      headline: "Сервер недоступен.",
      detail: "Страница не может связаться с otbor и обновится сама, когда сервер ответит."
    }
  }
  if (overview === undefined && input.overviewFailed === true) {
    return {
      tone: "warning",
      glyph: "attention",
      headline: "Не удалось получить данные обзора.",
      detail:
        health !== undefined && health.database
          ? "Сервер отвечает, а снимок обзора не собрался. Попробуйте обновить страницу."
          : "Состояние служб проверено отдельно, оно ниже."
    }
  }
  if (overview === undefined) {
    return { tone: "neutral", glyph: "loading", headline: "Проверяем, как идут дела…", detail: null }
  }
  if (health !== undefined && !health.database) {
    return {
      tone: "danger",
      glyph: "stop",
      headline: "База данных недоступна.",
      detail: "Пока она не вернётся, отклики и поиск вакансий не работают."
    }
  }

  const auto = autoAccounts(overview)
  const paused = (account: Overview["accounts"][number]): boolean =>
    account.submitBlockedAt !== null &&
    (account.submitRetryAt === null || Date.parse(account.submitRetryAt) > now - 60_000)
  const cannotSend = auto.filter((account) => paused(account) || account.session !== "ok")

  if (auto.length > 0 && cannotSend.length === auto.length) {
    const captcha = cannotSend.every(paused)
    const names = joinNames(cannotSend.map((account) => account.name))
    const where = cannotSend.length === 1 ? `на аккаунте ${names}` : `на аккаунтах ${names}`
    return {
      tone: "danger",
      glyph: "stop",
      headline: captcha
        ? `Отклики остановлены: hh просит капчу ${where}.`
        : `Отклики остановлены: нужно войти в hh ${where}.`,
      detail: "Остальная работа идёт: вакансии собираются, заявки готовятся."
    }
  }

  if (browserOnline(health) === false) {
    return {
      tone: "danger",
      glyph: "stop",
      headline: "Исполнитель браузера не подключён: отклики не отправляются.",
      detail: "Запустите его, и очередь продолжит работу сама."
    }
  }

  const problems = items.filter((item) => item.tone === "danger" || item.tone === "warning")
  const worst = problems.some((item) => item.tone === "danger") ? "danger" : "warning"
  const working = auto.length > 0 ? workingSentence(overview) : "Автоотклики выключены."

  if (problems.length > 0) {
    return {
      tone: worst,
      glyph: "attention",
      headline: `Нужно ваше участие: ${countWord(problems.length, QUESTION_FORMS)}.`,
      detail: join(working, auto.length > 0 && cannotSend.length > 0 ? "Часть аккаунтов не отправляет." : null)
    }
  }

  if (auto.length === 0) {
    return {
      tone: "neutral",
      glyph: "idle",
      headline: "Автоотклики выключены — система только собирает вакансии.",
      detail: join(
        `Новых вакансий за ${overview.days} ${overview.days === 1 ? "сутки" : "суток"}: ${formatNumber(overview.funnel.vacanciesFound)}.`,
        waitingSentence(overview)
      )
    }
  }

  return {
    tone: "success",
    glyph: "ok",
    headline: "Всё работает.",
    detail: join(workingSentence(overview), waitingSentence(overview))
  }
}
