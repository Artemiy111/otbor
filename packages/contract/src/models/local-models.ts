import { Schema } from "effect"

/**
 * Локальный сервер моделей с OpenAI-совместимым API (oMLX, LM Studio, ...).
 * Хранится в файле `~/.otbor/openai.json` на машине с сервером, не в БД.
 * Ключ API наружу не возвращается: только факт, что он задан.
 */
export const LocalModelServer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  hasKey: Schema.Boolean
})
export type LocalModelServer = typeof LocalModelServer.Type

/** Запись только на сохранение: `apiKey` — секрет, пустой не меняет сохранённый. */
export const LocalModelInput = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  name: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  /** Удалить сохранённый ключ (сервер без авторизации). */
  clearKey: Schema.optional(Schema.Boolean)
})
export type LocalModelInput = typeof LocalModelInput.Type

/** Живость сервера: результат `GET /models`, без вызова модели. */
export const LocalModelHealth = Schema.Struct({
  id: Schema.String,
  /** Процесс отвечает по HTTP (даже если ключ не принят). */
  alive: Schema.Boolean,
  /** Жив и отдаёт список моделей: на него можно слать задачи. */
  ok: Schema.Boolean,
  latencyMs: Schema.NullOr(Schema.Int),
  models: Schema.Int,
  /** Идентификаторы моделей сервера: из них выбирают модель для капчи. */
  modelIds: Schema.Array(Schema.String),
  error: Schema.NullOr(Schema.String),
  checkedAt: Schema.String
})
export type LocalModelHealth = typeof LocalModelHealth.Type

/**
 * Какой локальной моделью читать капчу hh. Хранится в `~/.otbor/captcha.json`
 * на машине харнеса: картинка уходит только на выбранный локальный сервер.
 */
export const CaptchaSolverSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** id сервера из списка локальных моделей. */
  harnessId: Schema.String,
  model: Schema.String,
  /** Сколько раз подряд вводить ответ, прежде чем остановить аккаунт. */
  maxAttempts: Schema.Int,
  timeoutSeconds: Schema.Int
})
export type CaptchaSolverSettings = typeof CaptchaSolverSettings.Type

/** Проверка на самой свежей сохранённой картинке капчи, без браузера. */
export const CaptchaSolverTestResult = Schema.Struct({
  ok: Schema.Boolean,
  text: Schema.NullOr(Schema.String),
  durationMs: Schema.Int,
  /** Имя файла картинки, на которой проверяли; `null`, если сохранённых нет. */
  picture: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String)
})
export type CaptchaSolverTestResult = typeof CaptchaSolverTestResult.Type
