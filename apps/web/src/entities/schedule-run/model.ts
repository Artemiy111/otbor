import type { ScheduleRun } from "@otbor/contract"
import { countWord, plural, type PluralForms } from "@/shared/lib/plural"
import { runSummary } from "@/shared/lib/run-summary"

export const scheduleRunKeys = {
  all: ["schedule-runs"] as const,
  list: (scheduleId?: string, kind?: string) => ["schedule-runs", "list", scheduleId ?? "all", kind ?? "all"] as const
}

const VACANCIES: PluralForms = ["вакансия", "вакансии", "вакансий"]
const NEW_VACANCIES: PluralForms = ["новая вакансия", "новые вакансии", "новых вакансий"]
const COMPANIES: PluralForms = ["компания", "компании", "компаний"]
const LETTERS: PluralForms = ["новое письмо", "новых письма", "новых писем"]
const MESSAGES: PluralForms = ["новое сообщение", "новых сообщения", "новых сообщений"]
const APPLICATIONS: PluralForms = ["отклик", "отклика", "откликов"]
const CHATS: PluralForms = ["чат", "чата", "чатов"]
const RESUMES: PluralForms = ["резюме", "резюме", "резюме"]
const ERRORS: PluralForms = ["ошибка", "ошибки", "ошибок"]

const STOPPED: Record<string, string> = {
  captcha: "капча hh.ru",
  auth: "нужен вход",
  forbidden: "hh.ru отказал в доступе",
  geo: "блокировка по региону",
  rate_limit: "лимит запросов hh.ru",
  unreachable: "модель недоступна",
  unauthorized: "ключ модели отклонён"
}

const record = (detail: unknown): Record<string, unknown> | null =>
  detail !== null && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null

/**
 * Итог запуска словами: «+12 новых вакансий, найдено 340». Пустая строка, если
 * по `detail` нечего сказать (запуск ещё идёт или ничего не записал). Один набор
 * фраз для страницы расписаний, поиска, догрузки и очереди.
 */
export const runResultText = (kind: string, detail: unknown): string => {
  const d = record(detail)
  if (d === null) return ""
  const num = (key: string): number => (typeof d[key] === "number" ? (d[key] as number) : 0)
  const has = (key: string): boolean => typeof d[key] === "number"
  const parts: string[] = []

  switch (kind) {
    case "search":
    case "source": {
      if (!has("found") && !has("inserted")) break
      const inserted = num("inserted")
      parts.push(inserted > 0 ? `+${countWord(inserted, NEW_VACANCIES)}` : "новых вакансий нет")
      if (num("found") > 0) parts.push(`найдено ${num("found")}`)
      if (num("evaluated") > 0) parts.push(`оценено ${num("evaluated")}`)
      if (d.status === "stopped") parts.push("остановлен")
      break
    }
    case "vacancy_hydration": {
      if (!has("processed")) break
      if (num("processed") === 0) parts.push("догружать нечего")
      else parts.push(`догружено ${countWord(num("hydrated") || num("updated"), VACANCIES)}`)
      break
    }
    case "employer_hydration": {
      if (!has("processed")) break
      if (num("processed") === 0) parts.push("обновлять нечего")
      else parts.push(`обновлено ${countWord(num("updated"), COMPANIES)}`)
      break
    }
    case "analysis": {
      if (d.disabled === true) {
        parts.push("анализ выключен в настройках")
        break
      }
      if (!has("processed") && !has("analysed")) break
      parts.push(num("analysed") > 0 ? `проанализировано ${countWord(num("analysed"), VACANCIES)}` : "анализировать нечего")
      break
    }
    case "evaluate": {
      if (!has("evaluated")) break
      if (num("evaluated") === 0) parts.push("новых оценок нет")
      else {
        parts.push(`оценено ${num("evaluated")}`)
        if (num("apply") > 0) parts.push(`откликаться: ${num("apply")}`)
      }
      break
    }
    case "fit": {
      if (!has("enqueued")) break
      parts.push(num("enqueued") > 0 ? `отправлено на оценку: ${num("enqueued")}` : "оценивать нечего")
      break
    }
    case "apply": {
      if (!has("selected") && !has("created")) break
      const done: string[] = []
      if (num("created") > 0) done.push(`создано ${countWord(num("created"), APPLICATIONS)}`)
      if (num("submitQueued") > 0) done.push(`на отправку ${num("submitQueued")}`)
      if (num("needsHuman") > 0) done.push(`нужен человек: ${num("needsHuman")}`)
      parts.push(done.length > 0 ? done.join(", ") : "откликать нечего")
      break
    }
    case "mail_sync":
    case "telegram_sync": {
      if (!has("processed") && !has("inserted")) break
      const forms = kind === "mail_sync" ? LETTERS : MESSAGES
      parts.push(num("inserted") > 0 ? `+${countWord(num("inserted"), forms)}` : "нового нет")
      if (num("contacts") > 0) parts.push(`контактов: ${num("contacts")}`)
      if (num("vacanciesFetched") > 0) parts.push(`загружено вакансий: ${num("vacanciesFetched")}`)
      break
    }
    case "resume_sync": {
      if (!has("queued") && !has("alreadyActive")) break
      parts.push(
        num("queued") > 0
          ? `на чтение: ${countWord(num("queued"), RESUMES)}`
          : num("alreadyActive") > 0
            ? "чтение уже идёт"
            : "читать нечего"
      )
      break
    }
    case "resume_bump": {
      if (!has("queued") && !has("candidates")) break
      parts.push(num("queued") > 0 ? `на подъём: ${countWord(num("queued"), RESUMES)}` : "подъём не нужен")
      break
    }
    case "hh_chat_sync": {
      if (!has("queued") && !has("candidates")) break
      parts.push(num("queued") > 0 ? `на чтение: ${countWord(num("queued"), CHATS)}` : "новых чатов нет")
      break
    }
    default:
      break
  }

  if (parts.length === 0) return runSummary(detail).join(", ")
  if (num("failed") > 0) parts.push(countWord(num("failed"), ERRORS))
  if (typeof d.stoppedBy === "string" && d.stoppedBy !== "") {
    parts.push(`остановлен: ${STOPPED[d.stoppedBy] ?? d.stoppedBy}`)
  }
  if (d.interrupted === true) parts.push("прерван")
  return parts.join(", ")
}

/** Ход незаконченного запуска: «обработано 3 из 25». Пустая строка, если счётчиков нет. */
export const runProgressText = (detail: unknown): string => {
  const d = record(detail)
  if (d === null) return ""
  const processed = typeof d.processed === "number" ? d.processed : null
  const target = typeof d.target === "number" ? d.target : null
  if (processed !== null && target !== null && target > 0) return `обработано ${processed} из ${target}`
  if (processed !== null && processed > 0) return `обработано ${processed}`
  return ""
}

export interface RunIndex {
  /** Последний законченный запуск по расписанию. */
  readonly latest: ReadonlyMap<string, ScheduleRun>
  /** Идущий сейчас запуск по расписанию. */
  readonly running: ReadonlyMap<string, ScheduleRun>
}

/** Запуски приходят новыми вперёд, но порядок не предполагается. */
export const indexRuns = (runs: ReadonlyArray<ScheduleRun>): RunIndex => {
  const latest = new Map<string, ScheduleRun>()
  const running = new Map<string, ScheduleRun>()
  const newer = (a: ScheduleRun, b: ScheduleRun | undefined): boolean =>
    b === undefined || Date.parse(a.startedAt) > Date.parse(b.startedAt)
  for (const run of runs) {
    const id = run.scheduleId as string
    if (run.status === "running") {
      if (newer(run, running.get(id))) running.set(id, run)
    } else if (newer(run, latest.get(id))) latest.set(id, run)
  }
  return { latest, running }
}

/** Единственное число для подписи «N запусков». */
export const runsWord = (count: number): string => plural(count, ["запуск", "запуска", "запусков"])

/** Сколько новых вакансий дал каждый из последних законченных запусков поиска; старые слева. */
export const insertedTrend = (runs: ReadonlyArray<ScheduleRun>, scheduleId: string, count = 8): ReadonlyArray<number> =>
  runs
    .filter((run) => run.scheduleId === scheduleId && run.status === "done")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, count)
    .reverse()
    .map((run) => {
      const detail = record(run.detail)
      return detail !== null && typeof detail.inserted === "number" ? detail.inserted : 0
    })
