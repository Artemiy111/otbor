import type { ApiError, SettingsView, UserSettings } from "@otbor/contract"
import { InvalidInput, UserSettings as UserSettingsSchema } from "@otbor/contract"
import { Config, Context, Effect, Layer, Schema } from "effect"
import { Database } from "../db/Database.ts"
import * as SettingsRepository from "../repositories/SettingsRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

/**
 * Значения по умолчанию из окружения облака. Они нужны, только пока у
 * пользователя нет своей строки настроек: после первого сохранения решает база.
 */
export const settingsDefaultsFromEnv = (
  overrides: Partial<UserSettings> = {}
): Effect.Effect<UserSettings, Config.ConfigError> =>
  Effect.gen(function*() {
    const builtin = SettingsRepository.BUILTIN_SETTINGS
    const int = (name: string, fallback: number) =>
      Config.Int(name).pipe(Config.withDefault(fallback))
    const accountBrowserConcurrency = yield* int(
      "OTBOR_ACCOUNT_BROWSER_CONCURRENCY",
      builtin.accountBrowserConcurrency
    )
    const accountActingConcurrency = yield* int(
      "OTBOR_ACCOUNT_SUBMIT_CONCURRENCY",
      builtin.accountActingConcurrency
    )
    const submitIntervalSeconds = yield* int(
      "OTBOR_ACCOUNT_SUBMIT_INTERVAL_SECONDS",
      builtin.submitIntervalSeconds
    )
    const submitJitterPercent = yield* int("OTBOR_ACCOUNT_SUBMIT_JITTER_PERCENT", builtin.submitJitterPercent)
    const harnessSlots = yield* int("OTBOR_HARNESS_CONCURRENCY", builtin.harnessSlots)
    return {
      accountBrowserConcurrency,
      accountActingConcurrency,
      submitIntervalSeconds,
      submitJitterPercent,
      submitHourlyLimit: builtin.submitHourlyLimit,
      harnessSlots,
      ...overrides
    }
  })

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<SettingsView, ApiError>
  readonly update: (input: UserSettings) => Effect.Effect<SettingsView, ApiError>
}

export class SettingsService extends Context.Service<SettingsService, SettingsServiceShape>()(
  "otbor/cloud/SettingsService"
) {
  static readonly layerWith = (defaults: UserSettings) =>
    Layer.effect(
      SettingsService,
      Effect.gen(function*() {
        const database = yield* Database
        const currentUser = yield* CurrentUser

        const view = (stored: SettingsRepository.StoredSettings | null): SettingsView => ({
          settings: stored?.settings ?? defaults,
          defaults,
          stored: stored !== null,
          updatedAt: stored?.updatedAt ?? null
        })

        const get: SettingsServiceShape["get"] = () =>
          database
            .asUser(currentUser.userId, (tx) => SettingsRepository.find(tx, currentUser.userId))
            .pipe(Effect.map(view), Effect.mapError(toStorageError("settings.get")))

        const update: SettingsServiceShape["update"] = (input) =>
          Effect.gen(function*() {
            // Диапазоны проверяет схема; транспорт уже прогнал её, но сервис вызывают и напрямую.
            const valid = yield* Schema.decodeUnknownEffect(UserSettingsSchema)(input).pipe(
              Effect.mapError((error) => new InvalidInput({ message: `invalid settings: ${error.message}` }))
            )
            if (valid.accountActingConcurrency > valid.accountBrowserConcurrency) {
              return yield* new InvalidInput({
                message: "acting jobs per account cannot exceed browser jobs per account"
              })
            }
            return yield* database
              .asUser(currentUser.userId, (tx) => SettingsRepository.upsert(tx, currentUser.userId, valid))
              .pipe(Effect.map(view), Effect.mapError(toStorageError("settings.update")))
          })

        return SettingsService.of({ get, update })
      })
    )

  /** Production layer: defaults from `OTBOR_ACCOUNT_*` / `OTBOR_HARNESS_CONCURRENCY`. */
  static readonly layerConfigured = (overrides: Partial<UserSettings> = {}) =>
    Layer.unwrap(Effect.map(settingsDefaultsFromEnv(overrides), SettingsService.layerWith))

  static readonly layer = SettingsService.layerConfigured()
}
