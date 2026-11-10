import type { HarnessJob } from "@otbor/contract"
import { humanizeError } from "@/entities/auto-apply/status"
import { formatAge, jobStageLabel } from "@/shared/lib"

/**
 * Задание очереди человеческими словами. Контракт `HarnessJob` не несёт ни
 * аккаунта, ни отклика, ни текста ошибки отдельными полями: всё это лежит в
 * `payload` и `result`, поэтому достаём оттуда и тихо пропускаем то, чего нет.
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

/** Сырой текст ошибки из результата задания: разные стадии кладут его в разные поля. */
export const jobRawError = (job: Pick<HarnessJob, "result">): string | null => {
  const result = record(job.result)
  if (result === null) return null
  const exit = record(result.exit)
  return text(result, "message") ?? text(result, "error") ?? text(result, "lastError") ?? text(exit, "message")
}

const FAILED = new Set(["failed", "dead", "needs_human", "needs_reconcile", "cancelled"])

/** Ошибка для человека; только у заданий, которые закончились плохо. */
export const jobError = (job: Pick<HarnessJob, "status" | "result">): string | null =>
  FAILED.has(job.status) ? humanizeError(jobRawError(job)) : null

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
