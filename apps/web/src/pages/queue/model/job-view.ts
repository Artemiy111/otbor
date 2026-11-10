import type { HarnessJob } from "@otbor/contract"
import { humanizeError } from "@/entities/auto-apply/status"
import { formatAge, jobStageLabel } from "@/shared/lib"

/**
 * Задание очереди человеческими словами. Сервер сам отдаёт аккаунт, вакансию,
 * отклик и `lastError`; здесь остались разбор `payload` и `result` для
 * сервера, который ещё не обновлён, и текст для человека.
 */

const JOB_TITLES: Readonly<Record<string, string>> = {
  prepare: "Подготовка отклика",
  submit: "Отправка отклика на hh",
  reconcile: "Проверка, ушёл ли отклик",
  session: "Обновление входа в hh",
  inference: "Генерация текста моделью",
  negotiations_sync: "Обновление статусов откликов",
  resume_sync: "Загрузка резюме с hh",
  form_read: "Чтение формы отклика",
  letter_attach: "Добавление письма к отклику",
  chat_read: "Чтение чата с работодателем",
  resume_bump: "Подъём резюме"
}

export const jobTitle = (stage: string): string => JOB_TITLES[stage] ?? jobStageLabel(stage)

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const text = (source: Record<string, unknown> | null, key: string): string | null => {
  const value = source?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

export interface JobRefs {
  readonly accountId: string | null
  readonly vacancyId: string | null
  readonly applicationId: string | null
  readonly resumeId: string | null
}

/** На кого и на что смотрит задание. */
export const jobRefs = (job: Pick<HarnessJob, "payload">): JobRefs => {
  const payload = record(job.payload)
  return {
    accountId: text(payload, "hhAccountId"),
    vacancyId: text(payload, "vacancyId"),
    applicationId: text(payload, "applicationId"),
    resumeId: text(payload, "resumeId")
  }
}

/** Модель, которую просили для генерации (подпись под названием задачи). */
export const jobDetail = (job: Pick<HarnessJob, "stage" | "payload">): string | null => {
  if (job.stage !== "inference") return null
  const payload = record(job.payload)
  const model = text(payload, "model")
  return model === null ? null : `модель ${model}`
}

/**
 * Сырой текст ошибки: `lastError` с сервера, а если его нет (старый сервер) -
 * результат задачи: разные стадии кладут его в разные поля.
 */
export const jobRawError = (job: { readonly result?: unknown; readonly lastError?: string | null }): string | null => {
  const last = text({ lastError: job.lastError }, "lastError")
  if (last !== null) return last
  const result = record(job.result)
  if (result === null) return null
  const exit = record(result.exit)
  return text(result, "message") ?? text(result, "error") ?? text(result, "lastError") ?? text(exit, "message")
}

const FAILED = new Set(["failed", "dead", "needs_human", "needs_reconcile", "cancelled"])
/** Задание ждёт повтора: прошлая попытка закончилась ошибкой, и это видно. */
const RETRYING = new Set(["pending", "leased", "running"])

/** Ошибка для человека: у неудачных заданий и у тех, что ждут повтора после ошибки. */
export const jobError = (job: {
  readonly status: string
  readonly result?: unknown
  readonly lastError?: string | null
}): string | null => {
  const shown = FAILED.has(job.status) || (RETRYING.has(job.status) && text({ e: job.lastError }, "e") !== null)
  return shown ? humanizeError(jobRawError(job)) : null
}

const seconds = (from: string, now: Date): number => {
  const time = Date.parse(from)
  return Number.isNaN(time) ? 0 : Math.max(0, (now.getTime() - time) / 1000)
}

/** Где задание во времени: сколько ждёт, до какого часа аренда, когда создано. */
export const jobTiming = (
  job: Pick<HarnessJob, "status" | "runAt" | "createdAt" | "leaseUntil">,
  now: Date = new Date()
): string => {
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  switch (job.status) {
    case "pending": {
      const run = Date.parse(job.runAt)
      if (!Number.isNaN(run) && run > now.getTime()) {
        return `запуск через ${formatAge((run - now.getTime()) / 1000)}`
      }
      return `ждёт ${formatAge(seconds(job.runAt, now))}`
    }
    case "leased":
    case "running":
      return job.leaseUntil ? `идёт, занято до ${clock(job.leaseUntil)}` : "идёт сейчас"
    default:
      return `создано ${formatAge(seconds(job.createdAt, now))} назад`
  }
}
