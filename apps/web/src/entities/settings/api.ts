import type { SettingsView, UserSettings } from "@otbor/contract"
import { call } from "@/shared/api"

export const settingsApi = {
  get: (): Promise<SettingsView> => call((client) => client.SettingsGet({})),
  update: (input: UserSettings): Promise<SettingsView> => call((client) => client.SettingsUpdate(input))
}
