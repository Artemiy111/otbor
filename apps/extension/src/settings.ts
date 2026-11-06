import { DEFAULT_SETTINGS, type Settings } from "./messages.ts"

export const loadSettings = async (): Promise<Settings> => {
  try {
    const stored = (await chrome.storage.local.get("settings")) as { settings?: Partial<Settings> }
    return { ...DEFAULT_SETTINGS, ...stored.settings }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (settings: Settings): Promise<void> =>
  chrome.storage.local.set({ settings })
