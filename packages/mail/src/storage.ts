import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { MailError } from "./errors.ts"

/** Credentials live outside the repository, in a 0600 JSON file per account. */
export interface MailSecret {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

export type MailEnv = Record<string, string | undefined>

const ACCOUNT_ID = /^[a-zA-Z0-9:_-]+$/
const DIR_MODE = 0o700
const FILE_MODE = 0o600

export const mailDir = (env: MailEnv = process.env): string =>
  env.OTBOR_MAIL_DIR?.trim() || join(homedir(), ".otbor", "mail")

export const assertAccountId = (id: string): void => {
  if (!ACCOUNT_ID.test(id)) {
    throw new MailError(
      "invalid_account_id",
      "mail account id may only contain letters, digits, ':', '_' and '-'"
    )
  }
}

const secretPath = (id: string, env?: MailEnv): string => {
  assertAccountId(id)
  return join(mailDir(env), `${id}.secret.json`)
}

const assertSecret = (secret: MailSecret): void => {
  const valid =
    typeof secret.host === "string" &&
    secret.host.trim().length > 0 &&
    Number.isInteger(secret.port) &&
    secret.port > 0 &&
    secret.port <= 65535 &&
    typeof secret.secure === "boolean" &&
    typeof secret.username === "string" &&
    secret.username.trim().length > 0 &&
    typeof secret.password === "string" &&
    secret.password.length > 0
  if (!valid) {
    throw new MailError(
      "bad_secret",
      "mail secret must contain host, port, secure, username and password"
    )
  }
}

export const writeAccountSecret = async (
  id: string,
  secret: MailSecret,
  env?: MailEnv
): Promise<void> => {
  assertAccountId(id)
  assertSecret(secret)
  const dir = mailDir(env)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  await chmod(dir, DIR_MODE)
  const path = secretPath(id, env)
  await writeFile(path, JSON.stringify(secret, null, 2), { mode: FILE_MODE })
  await chmod(path, FILE_MODE)
}

/** Null when the account has no stored secret; throws when the file is corrupt. */
export const readAccountSecret = async (id: string, env?: MailEnv): Promise<MailSecret | null> => {
  assertAccountId(id)
  let text: string
  try {
    text = await readFile(secretPath(id, env), "utf8")
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new MailError("bad_secret", "stored mail secret is not valid JSON", { cause: error })
  }
  try {
    assertSecret(parsed as MailSecret)
  } catch (error) {
    throw new MailError("bad_secret", "stored mail secret is incomplete", { cause: error })
  }
  return parsed as MailSecret
}

export const deleteAccountSecret = async (id: string, env?: MailEnv): Promise<void> => {
  assertAccountId(id)
  await rm(secretPath(id, env), { force: true })
}

export const accountSecretExists = async (id: string, env?: MailEnv): Promise<boolean> =>
  (await readAccountSecret(id, env)) !== null
