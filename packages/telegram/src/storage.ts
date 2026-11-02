/**
 * Local Telegram credentials and sessions.
 *
 * Files live outside the repository, next to the proxy settings:
 * `~/.otbor/telegram` or `OTBOR_TELEGRAM_DIR`. The directory is 0700, every
 * file is 0600, and a session string is never logged or committed.
 *
 * - `app.json` — application credentials from my.telegram.org, shared by all
 *   accounts.
 * - `<accountId>.json` — account settings (proxy, masked phone).
 * - `<accountId>.session` — the serialized MTProto session.
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface TelegramProxy {
  kind: "socks5" | "socks4"
  host: string
  port: number
  username?: string
  password?: string
}

/** Application-level credentials from my.telegram.org; shared by all accounts. */
export interface TelegramAppConfig {
  apiId: number
  apiHash: string
}

export interface TelegramAccountConfig {
  id: string
  /** Only the masked form is stored; the full number lives in Telegram. */
  phoneMasked: string | null
  proxy: TelegramProxy | null
  createdAt: string
}

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/

/** `~/.otbor/telegram`, or `OTBOR_TELEGRAM_DIR` for tests and alternate installs. */
export const telegramDir = (
  env: Record<string, string | undefined> = process.env
): string =>
  env.OTBOR_TELEGRAM_DIR?.trim() || join(homedir(), ".otbor", "telegram")

export const isValidAccountId = (id: string): boolean => ACCOUNT_ID.test(id)

/** Rejects anything that could escape the telegram directory. */
export const assertAccountId = (id: string): string => {
  if (!isValidAccountId(id)) {
    throw new Error(`Invalid Telegram account id: ${JSON.stringify(id)}`)
  }
  return id
}

export const appConfigPath = (
  env: Record<string, string | undefined> = process.env
): string => join(telegramDir(env), "app.json")

export const accountConfigPath = (
  id: string,
  env: Record<string, string | undefined> = process.env
): string => join(telegramDir(env), `${assertAccountId(id)}.json`)

export const sessionPath = (
  id: string,
  env: Record<string, string | undefined> = process.env
): string => join(telegramDir(env), `${assertAccountId(id)}.session`)

const ensureDir = async (
  env: Record<string, string | undefined>
): Promise<string> => {
  const dir = telegramDir(env)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  return dir
}

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

const readJson = async <T>(path: string): Promise<T | null> => {
  const text = await readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${path}: invalid JSON`)
  }
}

const writeSecret = async (path: string, contents: string): Promise<void> => {
  await writeFile(path, contents, { mode: 0o600 })
  await chmod(path, 0o600)
}

export const readAppConfig = async (
  env: Record<string, string | undefined> = process.env
): Promise<TelegramAppConfig | null> => readJson<TelegramAppConfig>(appConfigPath(env))

export const writeAppConfig = async (
  config: TelegramAppConfig,
  env: Record<string, string | undefined> = process.env
): Promise<string> => {
  await ensureDir(env)
  const path = appConfigPath(env)
  await writeSecret(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

export const readAccountConfig = async (
  id: string,
  env: Record<string, string | undefined> = process.env
): Promise<TelegramAccountConfig | null> =>
  readJson<TelegramAccountConfig>(accountConfigPath(id, env))

export const writeAccountConfig = async (
  config: TelegramAccountConfig,
  env: Record<string, string | undefined> = process.env
): Promise<string> => {
  await ensureDir(env)
  const path = accountConfigPath(config.id, env)
  await writeSecret(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

export const readSession = async (
  id: string,
  env: Record<string, string | undefined> = process.env
): Promise<string | null> => (await readText(sessionPath(id, env)))?.trim() || null

export const writeSession = async (
  id: string,
  session: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> => {
  await ensureDir(env)
  const path = sessionPath(id, env)
  await writeSecret(path, session.trim())
  return path
}

/** Removes the account settings and the session in one go. */
export const deleteAccountFiles = async (
  id: string,
  env: Record<string, string | undefined> = process.env
): Promise<void> => {
  await Promise.all([
    rm(accountConfigPath(id, env), { force: true }),
    rm(sessionPath(id, env), { force: true })
  ])
}

/** `+79991234567` becomes `+79***4567`; too-short numbers become `***`. */
export const maskPhone = (phone: string | null | undefined): string | null => {
  const raw = phone?.trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 6) return "***"
  return `${raw.startsWith("+") ? "+" : ""}${digits.slice(0, 2)}***${digits.slice(-4)}`
}

/** `socks5://user:pass@127.0.0.1:7897`, `socks4://…` or `host:port`. */
export const parseProxy = (
  value: string | null | undefined
): TelegramProxy | null => {
  const raw = value?.trim()
  if (!raw) return null

  let kind: TelegramProxy["kind"] = "socks5"
  let rest = raw
  const scheme = raw.match(/^(socks5|socks4):\/\//i)
  if (scheme) {
    kind = scheme[1]!.toLowerCase() as TelegramProxy["kind"]
    rest = raw.slice(scheme[0].length)
  }

  const at = rest.lastIndexOf("@")
  const auth = at >= 0 ? rest.slice(0, at) : null
  const hostPort = at >= 0 ? rest.slice(at + 1) : rest
  const [host, portRaw] = hostPort.split(":")
  const port = Number(portRaw)
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Invalid proxy: ${JSON.stringify(raw)}. Expected socks5://host:port`
    )
  }

  const [username, password] = auth
    ? auth.split(":").map((part) => decodeURIComponent(part))
    : []

  return {
    kind,
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {})
  }
}
