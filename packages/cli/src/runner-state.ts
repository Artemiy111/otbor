import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * The operator CLI owns the local runner registration. This is not product
 * data: it is the device credential and the stable runner id, kept outside the
 * repo with mode 0600. `otbor runner run` reads it; no shell wrapper needed.
 */
export interface SavedRunner {
  readonly id: string
  readonly name: string
  readonly token: string
  readonly apiUrl?: string
  readonly kinds?: ReadonlyArray<string>
  readonly accounts?: ReadonlyArray<string>
}

export const runnerStatePath = (
  env: Record<string, string | undefined> = process.env
): string => join(env.OTBOR_RUNNER_DIR?.trim() || join(homedir(), ".otbor"), "runner.json")

export const readRunnerState = (
  path = runnerStatePath()
): SavedRunner | null => {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(`Unable to read ${path}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `${path}: invalid JSON. Re-run \`otbor runner register --save ...\`.`
    )
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object.`)
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.token !== "string") {
    throw new Error(`${path}: missing runner id or token.`)
  }

  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : "local",
    token: record.token,
    ...(typeof record.apiUrl === "string" ? { apiUrl: record.apiUrl } : {}),
    ...(Array.isArray(record.kinds)
      ? { kinds: record.kinds.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(Array.isArray(record.accounts)
      ? { accounts: record.accounts.filter((item): item is string => typeof item === "string") }
      : {})
  }
}

export const writeRunnerState = (
  state: SavedRunner,
  path = runnerStatePath()
): string => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT"
