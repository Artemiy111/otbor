/**
 * Saved proxy settings. `otbor proxy set` writes this file, every other
 * process reads it; `OTBOR_PROXY_*` environment variables still win per field.
 *
 * The file lives in `~/.otbor/proxy/` next to other local secrets: a
 * subscription URL usually contains an access token, so it is created with
 * mode 0600 inside a 0700 directory.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ProxyRotate } from "./config"

export interface ProxyFileConfig {
  /** Ready-made local proxy; mutually exclusive with `subscriptionUrl`. */
  url?: string
  subscriptionUrl?: string
  controller?: string
  secret?: string
  group?: string
  rotate?: ProxyRotate
  maxRotations?: number
  workers?: number
  port?: number
  controllerPort?: number
}

/** `~/.otbor/proxy`, or `OTBOR_PROXY_DIR` for tests and alternate installs. */
export const proxySettingsDir = (
  env: Record<string, string | undefined> = process.env
): string =>
  env.OTBOR_PROXY_DIR?.trim() || join(homedir(), ".otbor", "proxy")

export const proxyFilePath = (
  env: Record<string, string | undefined> = process.env
): string => join(proxySettingsDir(env), "config.json")

export const readProxyFile = (path = proxyFilePath()): ProxyFileConfig | null => {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(`Не удалось прочитать ${path}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `${path}: некорректный JSON. Удалите файл или выполните ` +
        "`otbor proxy set <ссылка>` заново."
    )
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: ожидается JSON-объект.`)
  }
  return parsed as ProxyFileConfig
}

/** Atomic-ish write of a secret-bearing file: 0600, directory 0700. */
export const writeProxyFile = (
  file: ProxyFileConfig,
  path = proxyFilePath()
): string => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  return path
}

/** Returns true when a file was actually removed. */
export const clearProxyFile = (path = proxyFilePath()): boolean => {
  try {
    rmSync(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT"
