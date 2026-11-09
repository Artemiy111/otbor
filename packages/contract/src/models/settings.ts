import { Schema } from "effect"

const between = (minimum: number, maximum: number) =>
  Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum, maximum })))

/** Предел потоков харнесса и параллельности аккаунта. */
export const MAX_HARNESS_SLOTS = 12

/**
 * Настройки откликов и браузера одного пользователя. Живут в базе и
 * применяются без перезапуска: claim читает их при каждой выдаче задачи, а
 * харнесс узнаёт число потоков из ответа на `HarnessLeaseNext`.
 */
export const UserSettings = Schema.Struct({
  /** Браузерных задач одного аккаунта у одного харнесса разом, 1..12. */
  accountBrowserConcurrency: between(1, MAX_HARNESS_SLOTS),
  /** Из них действующих (отправка, письмо в чат), 1..12; не больше браузерных. */
  accountActingConcurrency: between(1, MAX_HARNESS_SLOTS),
  /** Минимум секунд между отправками одного аккаунта, 0..3600; 0 - без темпа. */
  submitIntervalSeconds: between(0, 3600),
  /** Случайная надбавка к интервалу, процентов от него, 0..200. */
  submitJitterPercent: between(0, 200),
  /** Не больше стольких отправок аккаунта за скользящий час, 1..1000; null - без лимита. */
  submitHourlyLimit: Schema.NullOr(between(1, 1000)),
  /** Потоки харнесса, 1..12. */
  harnessSlots: between(1, MAX_HARNESS_SLOTS),
  /** Чтений формы отклика (`form_read`, `prepare`) одного аккаунта разом, 1..12. */
  formReadConcurrency: between(1, MAX_HARNESS_SLOTS),
  /** Минимум секунд между стартами чтений формы одного аккаунта, 0..600; 0 - без темпа. */
  formReadIntervalSeconds: between(0, 600),
  /** Случайная надбавка к интервалу чтений, процентов от него, 0..200. */
  formReadJitterPercent: between(0, 200),
  /** Во сколько раз реже читать формы, пока аккаунт заблокирован капчей, 1..20. */
  formReadBlockedFactor: between(1, 20),
  /** Запускать ли анализ вакансий моделью SystemOne по расписанию; false - расписания `analysis` пропускаются. */
  analysisEnabled: Schema.Boolean
})

export type UserSettings = typeof UserSettings.Type

/** Настройки как их видит оператор: действующие значения и значения по умолчанию. */
export const SettingsView = Schema.Struct({
  settings: UserSettings,
  /** Что действует, пока строки нет (из окружения облака). */
  defaults: UserSettings,
  /** Сохранены ли настройки в базе; false - действуют значения по умолчанию. */
  stored: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.String)
})

export type SettingsView = typeof SettingsView.Type
