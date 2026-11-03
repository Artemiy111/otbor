import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Where the hh.ru browser sessions live on this machine. `otbor hh login`
 * writes a persistent Chrome profile here and the browser executor reuses the
 * same directory, so a logged-in session is shared by both.
 */

export const DEFAULT_PROFILE = "default"

export const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

/** `~/.otbor/hh/accounts`, or `OTBOR_HH_PROFILES_DIR` when set. */
export const hhAccountsDir = (env: Readonly<Record<string, string | undefined>> = process.env): string => {
  const override = env.OTBOR_HH_PROFILES_DIR?.trim()
  return override === undefined || override === ""
    ? join(homedir(), ".otbor", "hh", "accounts")
    : override
}

/** A profile name is one path segment: it can never climb out of the root. */
export const safeProfileName = (name: string | null | undefined): string => {
  const trimmed = (name ?? "").trim()
  if (trimmed === "" || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    return DEFAULT_PROFILE
  }
  return trimmed
}

export const hhProfileDir = (
  name: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
): string => join(hhAccountsDir(env), safeProfileName(name))

export const hhStoragePath = (
  name: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
): string => join(hhProfileDir(name, env), "storage-state.json")
