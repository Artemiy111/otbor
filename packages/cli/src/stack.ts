import { homedir } from "node:os"
import { join, resolve } from "node:path"

/**
 * Pure helpers for `otbor up | down | status | doctor`. Nothing here touches
 * the network, the filesystem or child processes, so the formatting and the
 * decisions can be unit tested.
 */

/** Repo root, from `packages/cli/src`. */
export const repoRoot = resolve(import.meta.dirname, "../../..")

export type ServiceName = "server" | "worker" | "web" | "harness"

export interface ServiceSpec {
  readonly name: ServiceName
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}

export interface StackOptions {
  readonly web: boolean
  readonly harness: boolean
}

export const serviceSpecs = (root: string, options: StackOptions): ReadonlyArray<ServiceSpec> => {
  const specs: Array<ServiceSpec> = [
    { name: "server", command: "bun", args: [join(root, "packages/cloud/src/server.ts")], cwd: root },
    { name: "worker", command: "bun", args: [join(root, "packages/cloud/src/worker.ts")], cwd: root }
  ]
  if (options.web) {
    specs.push({ name: "web", command: "bun", args: ["run", "dev"], cwd: join(root, "apps/web") })
  }
  if (options.harness) {
    specs.push({
      name: "harness",
      command: "bun",
      args: [join(root, "packages/cli/src/main.ts"), "harness", "run"],
      cwd: root
    })
  }
  return specs
}

/**
 * Процессы worker/harness, которые `otbor up` не запускал (вывод `ps -eo pid=,command=`).
 * Второй worker забирает jobs из той же очереди, а второй harness не может открыть
 * профиль Chrome аккаунта (SingletonLock), поэтому такие процессы мешают запуску.
 * Путь сопоставляется по суффиксу: старый процесс мог быть запущен с относительным путём.
 */
export const findStrayProcesses = (
  psOutput: string,
  names: ReadonlyArray<ServiceName>,
  selfPid: number = process.pid
): ReadonlyArray<{ readonly name: ServiceName; readonly pid: number; readonly command: string }> => {
  const found: Array<{ name: ServiceName; pid: number; command: string }> = []
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const command = match[2]!.trim()
    if (pid === selfPid) continue
    const args = command.split(/\s+/)
    if (args[0] === undefined || !/(^|\/)bun$/.test(args[0])) continue
    const script = args[1] ?? ""
    const rest = args.slice(2)
    for (const name of names) {
      const hit =
        (name === "server" && script.endsWith("packages/cloud/src/server.ts")) ||
        (name === "worker" && script.endsWith("packages/cloud/src/worker.ts")) ||
        (name === "harness" &&
          script.endsWith("packages/cli/src/main.ts") &&
          rest[0] === "harness" &&
          rest[1] === "run")
      if (hit) found.push({ name, pid, command })
    }
  }
  return found
}

export const ALL_SERVICES: ReadonlyArray<ServiceName> = ["server", "worker", "web", "harness"]

// ---------------------------------------------------------------- pid files

export const runDir = (env: Record<string, string | undefined> = process.env): string =>
  env.OTBOR_RUN_DIR?.trim() || join(homedir(), ".otbor", "run")

export const pidFilePath = (name: string, dir: string = runDir()): string => join(dir, `${name}.pid`)

export const logFilePath = (name: string, root: string = repoRoot): string =>
  join(root, "logs", `${name}.log`)

/** A pid file holds one positive integer. Anything else is treated as absent. */
export const parsePid = (text: string): number | null => {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const pid = Number(trimmed)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

// --------------------------------------------------------------- addresses

export interface Endpoints {
  readonly host: string
  readonly port: number
  readonly api: string
  readonly health: string
  readonly web: string
  readonly webPort: number
}

export const WEB_PORT = 5173

export const endpoints = (env: Record<string, string | undefined> = process.env): Endpoints => {
  const host = env.HOST?.trim() || "127.0.0.1"
  const parsed = Number(env.PORT)
  const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3001
  // 0.0.0.0 is a bind address, not something a client can dial.
  const dial = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
  return {
    host,
    port,
    api: `http://${dial}:${port}/rpc`,
    health: `http://${dial}:${port}/health`,
    web: `http://127.0.0.1:${WEB_PORT}`,
    webPort: WEB_PORT
  }
}

/** Host and port of the Postgres in `DATABASE_URL`, with the compose default. */
export const databaseAddress = (
  url: string | undefined
): { readonly host: string; readonly port: number } => {
  const fallback = { host: "127.0.0.1", port: 55432 }
  if (url === undefined || url.trim() === "") return fallback
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname || fallback.host,
      port: parsed.port === "" ? 5432 : Number(parsed.port)
    }
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- formatting

const COLORS = [36, 35, 33, 32, 34] as const

export const colorFor = (index: number): number => COLORS[index % COLORS.length]!

/** `server  | ` padded to the longest service name, optionally colored. */
export const linePrefix = (
  name: string,
  width: number,
  color: number | null
): string => {
  const label = `${name.padEnd(width)} |`
  return color === null ? `${label} ` : `\u001b[${color}m${label}\u001b[0m `
}

export const banner = (
  endpointsValue: Pick<Endpoints, "api" | "health" | "web">,
  services: ReadonlyArray<ServiceName>
): string => {
  const rows: Array<readonly [string, string]> = [["api", endpointsValue.api]]
  if (services.includes("web")) rows.push(["web", endpointsValue.web])
  rows.push(["health", endpointsValue.health])
  const lines = rows.map(([label, value]) => `  ${label.padEnd(7)} ${value}`)
  return ["otbor is up", ...lines].join("\n")
}

export type CheckState = "ok" | "fail" | "warn" | "skip"

export interface Check {
  readonly name: string
  readonly state: CheckState
  readonly detail: string
  /** Shown by `doctor` when the check is not ok. */
  readonly hint?: string
  /** Only required checks make `doctor` exit non-zero. */
  readonly required?: boolean
}

const MARK: Record<CheckState, string> = { ok: "ok", fail: "FAIL", warn: "warn", skip: "-" }

export const formatTable = (checks: ReadonlyArray<Check>): string => {
  const width = checks.reduce((max, check) => Math.max(max, check.name.length), 0)
  return checks
    .map((check) => `${check.name.padEnd(width)}  ${MARK[check.state].padEnd(4)}  ${check.detail}`)
    .join("\n")
}

export const formatHints = (checks: ReadonlyArray<Check>): string =>
  checks
    .values()
    .filter((check) => (check.state === "fail" || check.state === "warn") && check.hint !== undefined)
    .map((check) => `  ${check.name}: ${check.hint}`)
    .toArray()
    .join("\n")

/** `doctor` fails only on required checks that failed. */
export const doctorExitCode = (checks: ReadonlyArray<Check>): 0 | 1 =>
  checks.some((check) => check.state === "fail" && check.required !== false) ? 1 : 0

/** `status` is healthy when postgres and api are up and the worker runs. */
export const statusSummary = (checks: ReadonlyArray<Check>): "up" | "degraded" | "down" => {
  const byName = new Map(checks.map((check) => [check.name, check.state]))
  const core = ["postgres", "api", "worker"].map((name) => byName.get(name) === "ok")
  if (core.every(Boolean)) return "up"
  return core.some(Boolean) ? "degraded" : "down"
}

/** Unix mode bits for a file in a 0600-only context. */
export const isPrivateMode = (mode: number): boolean => (mode & 0o077) === 0

/** Compare migration ids on disk with the ones recorded in the database. */
export const pendingMigrations = (
  onDisk: ReadonlyArray<{ readonly id: number; readonly name: string }>,
  applied: ReadonlyArray<number>
): ReadonlyArray<string> => {
  const done = new Set(applied)
  return onDisk.values().filter((file) => !done.has(file.id)).map((file) => `${file.id}_${file.name}`).toArray()
}

/** Minimum bun the repo is written against: major.minor.patch comparison. */
export const versionAtLeast = (actual: string, minimum: string): boolean => {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(actual)
  const right = parse(minimum)
  for (let index = 0; index < 3; index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}
