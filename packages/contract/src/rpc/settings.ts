import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { SettingsView, UserSettings } from "../models/index.ts"

/** Настройки откликов и браузера текущего пользователя. */
export const SettingsGet = Rpc.make("SettingsGet", {
  payload: Schema.Struct({}),
  success: SettingsView,
  error: ApiError
})

/** Сохраняет все поля разом; действует со следующей выдачи задачи, без перезапуска. */
export const SettingsUpdate = Rpc.make("SettingsUpdate", {
  payload: UserSettings,
  success: SettingsView,
  error: ApiError
})
