import { browser } from "wxt/browser"
import { DEFAULT_SETTINGS, type Settings } from "./messages.ts"

export const loadSettings = async (): Promise<Settings> => {
  try {
    const stored = (await browser.storage.local.get("settings")) as { settings?: Partial<Settings> }
    return { ...DEFAULT_SETTINGS, ...stored.settings }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (settings: Settings): Promise<void> =>
  browser.storage.local.set({ settings })
