import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Шифрование cookies аккаунта hh.ru перед записью в Postgres (AES-256-GCM).
 *
 * Ключ берётся из `OTBOR_SESSION_KEY` (32 байта в base64). Если переменной нет,
 * ключ создаётся один раз в `~/.otbor/session.key` (режим 0600). В контейнере
 * ключ передаётся переменной окружения или секретом.
 */

const KEY_BYTES = 32

const keyFile = (env: Readonly<Record<string, string | undefined>>): string =>
  env.OTBOR_SESSION_KEY_FILE?.trim() || join(homedir(), ".otbor", "session.key")

const parseKey = (text: string): Buffer | null => {
  const key = Buffer.from(text.trim(), "base64")
  return key.length === KEY_BYTES ? key : null
}

export const loadSessionKey = (env: Readonly<Record<string, string | undefined>> = process.env): Buffer => {
  const fromEnv = env.OTBOR_SESSION_KEY?.trim()
  if (fromEnv !== undefined && fromEnv !== "") {
    const key = parseKey(fromEnv)
    if (key === null) throw new Error("OTBOR_SESSION_KEY must be 32 bytes in base64")
    return key
  }
  const path = keyFile(env)
  if (existsSync(path)) {
    const key = parseKey(readFileSync(path, "utf8"))
    if (key === null) throw new Error(`${path} must hold 32 bytes in base64`)
    return key
  }
  const key = randomBytes(KEY_BYTES)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${key.toString("base64")}\n`, { mode: 0o600 })
  return key
}

/** `v1.<iv>.<tag>.<data>`, все части base64url. */
export const encryptSession = (plain: string, key: Buffer): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".")
}

export const decryptSession = (sealed: string, key: Buffer): string => {
  const [version, iv, tag, data] = sealed.split(".")
  if (version !== "v1" || iv === undefined || tag === undefined || data === undefined) {
    throw new Error("unknown session ciphertext format")
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}
