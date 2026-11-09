import { migrateProgram, migrationFiles } from "@otbor/cloud"
import {
  loadProxyConfig,
  proxyFilePath,
  startEngine,
  waitForNodes
} from "@otbor/crawler"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Console, Duration, Effect, Logger, Schema, Stream } from "effect"
import { Command, Flag } from "effect/cli"
import { execFile, spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { connect } from "node:net"
import { Api } from "../client.ts"
import { harnessStatePath } from "../harness-state.ts"
import {
  ALL_SERVICES,
  banner,
  colorFor,
  databaseAddress,
  doctorExitCode,
  findStrayProcesses,
  endpoints,
  formatHints,
  formatTable,
  isPrivateMode,
  linePrefix,
  logFilePath,
  parsePid,
  pendingMigrations,
  pidFilePath,
  repoRoot,
  serviceSpecs,
  statusSummary,
  versionAtLeast,
  type Check,
  type ServiceName,
  type ServiceSpec
} from "../stack.ts"

export class StackError extends Schema.TaggedError<StackError>()("StackError", {
  message: Schema.String
}) {}

// ------------------------------------------------------------------ probes

const tcpOpen = (host: string, port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((done) => {
    const socket = connect({ host, port })
    const finish = (value: boolean) => {
      socket.destroy()
      done(value)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })

const httpOk = (url: string, timeoutMs = 2000): Promise<boolean> =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(
    (response) => response.ok,
    () => false
  )

const run = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly timeoutMs?: number } = {}
): Promise<{ readonly code: number | null; readonly out: string; readonly missing: boolean }> =>
  new Promise((done) => {
    execFile(
      command,
      [...args],
      { cwd: options.cwd, timeout: options.timeoutMs ?? 120_000, encoding: "utf8" },
      (error, stdout, stderr) => {
        const out = `${stdout}${stderr}`.trim()
        if (error === null) return done({ code: 0, out, missing: false })
        const errno = error as NodeJS.ErrnoException
        done({
          code: typeof errno.code === "number" ? errno.code : null,
          out: out === "" ? error.message : out,
          missing: errno.code === "ENOENT"
        })
      }
    )
  })

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Live pid from a pid file, or null (absent, garbage or stale). */
const livePid = (name: string): number | null => {
  try {
    const pid = parsePid(readFileSync(pidFilePath(name), "utf8"))
    return pid !== null && alive(pid) ? pid : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

const waitFor = async (probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await sleep(500)
  }
  return false
}

// ---------------------------------------------------------------- postgres

const dbAddress = () => databaseAddress(process.env.DATABASE_URL)

const postgresUp = () => {
  const { host, port } = dbAddress()
  return tcpOpen(host, port)
}

const ensurePostgres = Effect.fn("stack.ensurePostgres")(function*() {
  if (yield* Effect.promise(postgresUp)) {
    yield* Console.log("postgres: reachable")
    return
  }
  const info = yield* Effect.promise(() => run("docker", ["info"], { timeoutMs: 15_000 }))
  if (info.missing) {
    return yield* new StackError({
      message: "Postgres is not reachable and `docker` is not installed. Install Docker or point DATABASE_URL at a running Postgres."
    })
  }
  if (info.code !== 0) {
    return yield* new StackError({
      message: "Postgres is not reachable and the Docker daemon is not running. Start Docker, then retry."
    })
  }
  yield* Console.log("postgres: starting (docker compose up -d --wait postgres)")
  const result = yield* Effect.promise(() =>
    run("docker", ["compose", "up", "-d", "--wait", "postgres"], { cwd: repoRoot })
  )
  if (result.code !== 0) {
    return yield* new StackError({ message: `docker compose failed:\n${result.out}` })
  }
  yield* Console.log("postgres: ready")
})

const migrate = Effect.fn("stack.migrate")(function*() {
  const total = migrationFiles().length
  const applied = yield* migrateProgram().pipe(
    Effect.provide(Logger.layer([])),
    Effect.mapError((cause) =>
      new StackError({
        message: `Migrations failed: ${cause instanceof Error ? cause.message : String(cause)}. Is DATABASE_URL set (see .env.example)?`
      })
    )
  )
  yield* Console.log(
    applied.length === 0
      ? "migrations: up to date"
      : `migrations: applied ${applied.length}: ${applied.map(([id, name]) => `${id}_${name}`).join(", ")}`
  )
  if (applied.length > 0 && applied.length === total) {
    yield* Console.log("hint: fresh database, run `otbor db seed` to import the lexicon and create the first hh account")
  }
})

// ---------------------------------------------------------------- proxy

const startProxy = Effect.fn("stack.startProxy")(function*() {
  const config = loadProxyConfig()
  if (config === null) {
    yield* Console.log("proxy: not configured, skipping (see `otbor proxy set`)")
    return
  }
  if (config.source === "endpoint") {
    yield* Console.log("proxy: external endpoint, nothing to start")
    return
  }
  yield* Effect.tryPromise({
    try: async () => {
      await startEngine(config, { timeoutMs: 60_000 })
      return waitForNodes(config)
    },
    catch: (error) => new StackError({ message: `proxy up failed: ${error instanceof Error ? error.message : String(error)}` })
  })
  yield* Console.log("proxy: mihomo started")
})

// ------------------------------------------------------------ foreground

const waitHealthy = (url: string) => Effect.promise(() => waitFor(() => httpOk(url), 60_000))

const runForeground = Effect.fn("stack.runForeground")(function*(specs: ReadonlyArray<ServiceSpec>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const width = specs.reduce((max, spec) => Math.max(max, spec.name.length), 0)
  const color = process.stdout.isTTY === true
  const urls = endpoints()

  // Spawned in this scope: leaving it (Ctrl+C, SIGTERM, a sibling dying)
  // terminates every child.
  const children = yield* Effect.forEach(specs, (spec, index) =>
    Effect.gen(function*() {
      const handle = yield* spawner.spawn(
        ChildProcess.make(spec.command, [...spec.args], {
          cwd: spec.cwd,
          env: { FORCE_COLOR: color ? "1" : undefined },
          extendEnv: true,
          stdin: "ignore",
          forceKillAfter: Duration.seconds(5)
        })
      )
      const prefix = linePrefix(spec.name, width, color ? colorFor(index) : null)
      yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => Console.log(`${prefix}${line}`)),
        Effect.ignore,
        Effect.forkScoped
      )
      return { spec, handle }
    })
  )

  yield* waitHealthy(urls.health).pipe(
    Effect.flatMap((healthy) =>
      healthy
        ? Console.log(banner(urls, specs.map((spec) => spec.name)))
        : Console.error(`API did not answer ${urls.health} within 60s; services are still running.`)
    ),
    Effect.forkScoped
  )

  const exited = yield* Effect.raceAll(
    children.map(({ spec, handle }) =>
      handle.exitCode.pipe(Effect.map((code) => ({ name: spec.name, code: Number(code) })))
    )
  )
  yield* Console.error(`${exited.name} exited unexpectedly (code ${exited.code}); stopping the rest.`)
  process.exitCode = 1
}, Effect.scoped)

// ------------------------------------------------------------ detached

const startDetached = (spec: ServiceSpec): string => {
  const existing = livePid(spec.name)
  if (existing !== null) return `${spec.name}: already running (pid ${existing})`

  const pidPath = pidFilePath(spec.name)
  const logPath = logFilePath(spec.name)
  mkdirSync(dirname(pidPath), { recursive: true })
  mkdirSync(dirname(logPath), { recursive: true })
  const fd = openSync(logPath, "a")
  try {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: process.env
    })
    child.unref()
    if (child.pid === undefined) throw new Error(`${spec.name}: failed to spawn`)
    writeFileSync(pidPath, `${child.pid}\n`)
    return `${spec.name}: started (pid ${child.pid}, log ${logPath})`
  } finally {
    closeSync(fd)
  }
}

/**
 * A port held by a process `otbor up` did not start (an old `bun run server`,
 * a stray vite) would make the new child die on bind while /health keeps
 * answering from the old build. Refuse instead of reporting a false "up".
 */
const portOwner = async (port: number): Promise<string> => {
  const result = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
  const pid = result.out.trim().split("\n")[0]?.trim()
  if (result.code !== 0 || pid === undefined || pid === "") return "another process"
  const ps = await run("ps", ["-p", pid, "-o", "command="])
  return `pid ${pid}${ps.code === 0 && ps.out.trim() !== "" ? ` (${ps.out.trim()})` : ""}`
}

const ensurePortsFree = Effect.fn("stack.ensurePortsFree")(function*(specs: ReadonlyArray<ServiceSpec>) {
  const urls = endpoints()
  const ports: Array<{ readonly name: ServiceName; readonly host: string; readonly port: number }> = []
  for (const spec of specs) {
    if (spec.name === "server") ports.push({ name: "server", host: urls.host === "0.0.0.0" ? "127.0.0.1" : urls.host, port: urls.port })
    if (spec.name === "web") ports.push({ name: "web", host: "127.0.0.1", port: urls.webPort })
  }
  for (const { name, host, port } of ports) {
    if (livePid(name) !== null) continue
    const busy = yield* Effect.promise(() => tcpOpen(host, port))
    if (!busy) continue
    const owner = yield* Effect.promise(() => portOwner(port))
    return yield* new StackError({
      message: `${name}: port ${port} is already in use by ${owner}, which otbor up did not start. Stop it first (or set PORT).`
    })
  }
})

/**
 * Worker или harness, оставшийся от прошлого запуска (например, после падения `up`),
 * держит очередь и профиль Chrome. Отказываем вместо второго экземпляра.
 */
const ensureNoStrayProcesses = Effect.fn("stack.ensureNoStrayProcesses")(function*(specs: ReadonlyArray<ServiceSpec>) {
  const names = specs.map((spec) => spec.name).filter((name) => livePid(name) === null)
  const ps = yield* Effect.promise(() => run("ps", ["-eo", "pid=,command="]))
  if (ps.code !== 0) return
  const stray = findStrayProcesses(ps.out, names)
  if (stray.length === 0) return
  return yield* new StackError({
    message:
      `Already running and not started by this otbor up: ${stray.map((p) => `${p.name} (pid ${p.pid})`).join(", ")}. ` +
      `Two copies would fight over the queue and the hh Chrome profile. Stop them by pid (kill ${stray.map((p) => p.pid).join(" ")}) and retry.`
  })
})

// ---------------------------------------------------------------- up

const up = Command.make(
  "up",
  {
    noWeb: Flag.Boolean("no-web").pipe(
      Flag.withDescription("Do not start the Vite dev server"),
      Flag.withDefault(false)
    ),
    harness: Flag.Boolean("harness").pipe(
      Flag.withDescription("Run `otbor harness run` (default: on when ~/.otbor/harness.json exists)"),
      Flag.withDefault(false)
    ),
    noHarness: Flag.Boolean("no-harness").pipe(
      Flag.withDescription("Do not run the harness even if it is registered"),
      Flag.withDefault(false)
    ),
    proxy: Flag.Boolean("proxy").pipe(
      Flag.withDescription("Run `otbor proxy up` first (mihomo in Docker)"),
      Flag.withDefault(false)
    ),
    detach: Flag.Boolean("detach").pipe(
      Flag.withAlias("d"),
      Flag.withDescription("Run in the background; pid files in ~/.otbor/run, logs in ./logs"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ noWeb, harness, noHarness, proxy, detach }) {
    yield* ensurePostgres()
    yield* migrate()
    if (proxy) yield* startProxy()

    const specs = serviceSpecs(repoRoot, {
      web: !noWeb,
      harness: !noHarness && (harness || existsSync(harnessStatePath()))
    })
    const names = specs.map((spec) => spec.name)
    yield* ensurePortsFree(specs)
    yield* ensureNoStrayProcesses(specs)

    if (!detach) {
      yield* runForeground(specs)
      return
    }

    const lines = yield* Effect.try({
      try: () => specs.map(startDetached),
      catch: (error) => new StackError({ message: error instanceof Error ? error.message : String(error) })
    })
    for (const line of lines) yield* Console.log(line)

    const urls = endpoints()
    const healthy = yield* waitHealthy(urls.health)
    if (!healthy) {
      return yield* new StackError({
        message: `API did not answer ${urls.health} within 60s. See ${logFilePath("server")}.`
      })
    }
    const dead = specs.filter((spec) => livePid(spec.name) === null)
    if (dead.length > 0) {
      return yield* new StackError({
        message: `exited right after start: ${dead
          .map((spec) => `${spec.name} (see ${logFilePath(spec.name)})`)
          .join(", ")}`
      })
    }
    yield* Console.log(banner(urls, names))
    yield* Console.log("stop with: otbor down")
  })
).pipe(Command.withDescription("Start Postgres, migrate, then run server, worker and web"))

// ---------------------------------------------------------------- down

const stopDetached = async (name: ServiceName): Promise<string | null> => {
  const path = pidFilePath(name)
  if (!existsSync(path)) return null
  const pid = livePid(name)
  if (pid === null) {
    rmSync(path, { force: true })
    return `${name}: stale pid file removed`
  }
  // Detached children lead their own process group, so signal the group to
  // take `bun run dev` -> vite with it.
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        process.kill(pid, sig)
      } catch {
        // already gone
      }
    }
  }
  signal("SIGTERM")
  const stopped = await waitFor(async () => !alive(pid), 10_000)
  if (!stopped) {
    signal("SIGKILL")
    await waitFor(async () => !alive(pid), 3_000)
  }
  rmSync(path, { force: true })
  return `${name}: ${stopped ? "stopped" : "killed"} (pid ${pid})`
}

const down = Command.make(
  "down",
  {
    db: Flag.Boolean("db").pipe(
      Flag.withDescription("Also stop the Postgres container"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ db }) {
    let any = false
    for (const name of ALL_SERVICES) {
      const line = yield* Effect.promise(() => stopDetached(name))
      if (line !== null) {
        any = true
        yield* Console.log(line)
      }
    }
    if (!any) yield* Console.log("no detached services were running")
    if (db) {
      const result = yield* Effect.promise(() =>
        run("docker", ["compose", "stop", "postgres"], { cwd: repoRoot })
      )
      if (result.code !== 0) {
        return yield* new StackError({ message: `docker compose stop failed:\n${result.out}` })
      }
      yield* Console.log("postgres: stopped")
    }
  })
).pipe(Command.withDescription("Stop services started with `otbor up --detach`"))

// ---------------------------------------------------------------- status

const pidCheck = (name: ServiceName, extra = ""): Check => {
  const pid = livePid(name)
  return pid === null
    ? { name, state: "fail", detail: `not running${extra}` }
    : { name, state: "ok", detail: `pid ${pid}${extra}` }
}

const statusChecks = Effect.fn("stack.statusChecks")(function*() {
  const urls = endpoints()
  const { host, port } = dbAddress()
  const postgres = yield* Effect.promise(() => tcpOpen(host, port))
  const health = yield* Effect.promise(() => httpOk(urls.health))
  const web = yield* Effect.promise(() => tcpOpen("127.0.0.1", urls.webPort))

  const api = yield* Api
  const rpc = health
    ? yield* api.SystemHealth().pipe(
        Effect.timeout(Duration.seconds(3)),
        Effect.match({ onFailure: () => null, onSuccess: (value) => value })
      )
    : null

  const harnessSaved = existsSync(harnessStatePath())
  const harnessPid = livePid("harness")
  const serverPid = livePid("server")
  const webPid = livePid("web")
  const foreign = " (not started by otbor up)"
  const harnessOnline = (rpc?.harnesses ?? []).some((h) => h.online)

  const checks: Array<Check> = [
    {
      name: "postgres",
      state: postgres ? "ok" : "fail",
      detail: `${host}:${port} ${postgres ? "reachable" : "unreachable"}`
    },
    {
      name: "api",
      state: !health ? "fail" : rpc === null || serverPid === null ? "warn" : rpc.database ? "ok" : "warn",
      detail: !health
        ? `${urls.health} not answering`
        : rpc === null
          ? "/health ok, SystemHealth RPC failed"
          : `${rpc.status} v${rpc.version}, database ${rpc.database ? "ok" : "down"}${serverPid === null ? foreign : ""}`
    },
    pidCheck("worker"),
    {
      name: "web",
      state: !web ? "fail" : webPid === null ? "warn" : "ok",
      detail: web ? `${urls.web}${webPid === null ? foreign : ""}` : `port ${urls.webPort} closed`
    },
    {
      name: "harness",
      // The API's heartbeat view wins: a harness started by hand in a terminal counts.
      state: harnessOnline ? "ok" : harnessSaved ? "warn" : "skip",
      detail: harnessOnline
        ? `online${harnessPid !== null ? `, pid ${harnessPid}` : ""}`
        : `not running, so inference and browser jobs wait in the queue; start: otbor harness run` +
          (harnessSaved ? "" : " (not registered yet)")
    }
  ]
  return checks
})

const status = Command.make(
  "status",
  { json: Flag.Boolean("json").pipe(Flag.withDefault(false)) },
  Effect.fn(function*({ json }) {
    const checks = yield* statusChecks()
    const summary = statusSummary(checks)
    if (json) {
      yield* Console.log(JSON.stringify({ status: summary, services: checks }, null, 2))
    } else {
      yield* Console.log(formatTable(checks))
      yield* Console.log(`\nstack: ${summary}`)
    }
    if (summary !== "up") process.exitCode = 1
  })
).pipe(Command.withDescription("Show which parts of the stack are running"))

// ---------------------------------------------------------------- doctor

const appliedMigrationIds = async (): Promise<ReadonlyArray<number> | null> => {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === "") return null
  const sql = new Bun.SQL(url)
  try {
    const rows = await sql`select migration_id from effect_sql_migrations`
    return rows.map((row: { migration_id: number | string }) => Number(row.migration_id))
  } catch {
    // Table missing: nothing applied yet.
    return []
  } finally {
    await sql.close().catch(() => undefined)
  }
}

const doctorChecks = Effect.fn("stack.doctorChecks")(function*() {
  const checks: Array<Check> = []
  const urls = endpoints()
  const { host, port } = dbAddress()

  const bunVersion = Bun.version
  checks.push(
    versionAtLeast(bunVersion, "1.2.0")
      ? { name: "bun", state: "ok", detail: bunVersion }
      : { name: "bun", state: "fail", detail: bunVersion, hint: "upgrade with `bun upgrade` (need >= 1.2)" }
  )

  const docker = yield* Effect.promise(() => run("docker", ["info"], { timeoutMs: 15_000 }))
  checks.push(
    docker.code === 0
      ? { name: "docker", state: "ok", detail: "daemon running" }
      : {
          name: "docker",
          state: "warn",
          detail: docker.missing ? "not installed" : "daemon not running",
          hint: "needed only to run Postgres via docker-compose.yml; start Docker or use your own Postgres",
          required: false
        }
  )

  const envFile = existsSync(`${repoRoot}/.env`)
  checks.push(
    envFile
      ? { name: ".env", state: "ok", detail: `${repoRoot}/.env` }
      : {
          name: ".env",
          state: process.env.DATABASE_URL ? "warn" : "fail",
          detail: "missing",
          hint: "cp .env.example .env"
        }
  )

  const postgres = yield* Effect.promise(() => tcpOpen(host, port))
  checks.push(
    postgres
      ? { name: "postgres", state: "ok", detail: `${host}:${port}` }
      : {
          name: "postgres",
          state: "fail",
          detail: `${host}:${port} unreachable`,
          hint: "run `otbor up` or `docker compose up -d --wait postgres`"
        }
  )

  if (postgres) {
    const applied = yield* Effect.promise(() => appliedMigrationIds())
    if (applied === null) {
      checks.push({
        name: "migrations",
        state: "fail",
        detail: "DATABASE_URL is not set",
        hint: "set DATABASE_URL in .env"
      })
    } else {
      const pending = pendingMigrations(migrationFiles(), applied)
      checks.push(
        pending.length === 0
          ? { name: "migrations", state: "ok", detail: "up to date" }
          : {
              name: "migrations",
              state: "fail",
              detail: `${pending.length} pending (${pending[0]}...)`,
              hint: "run `otbor db migrate` (or `otbor up`)"
            }
      )
    }
  } else {
    checks.push({ name: "migrations", state: "skip", detail: "postgres unreachable" })
  }

  const health = yield* Effect.promise(() => httpOk(urls.health))
  checks.push(
    health
      ? { name: "api", state: "ok", detail: urls.health }
      : {
          name: "api",
          state: "fail",
          detail: `${urls.health} not answering`,
          hint: "run `otbor up` (or `bun run server`)"
        }
  )

  // Proxy: only presence and permissions, never the contents.
  const proxyPath = proxyFilePath()
  const proxyEnv = Boolean(process.env.OTBOR_PROXY_URL?.trim() || process.env.OTBOR_PROXY_SUB_URL?.trim())
  if (existsSync(proxyPath)) {
    const mode = statSync(proxyPath).mode
    checks.push(
      isPrivateMode(mode)
        ? { name: "proxy", state: "ok", detail: `${proxyPath} (0600)`, required: false }
        : {
            name: "proxy",
            state: "warn",
            detail: `${proxyPath} is readable by others`,
            hint: `chmod 600 ${proxyPath}`,
            required: false
          }
    )
  } else if (proxyEnv) {
    checks.push({ name: "proxy", state: "ok", detail: "OTBOR_PROXY_* environment", required: false })
  } else {
    checks.push({
      name: "proxy",
      state: "warn",
      detail: "not configured",
      hint: "crawling hh.ru may need it: `otbor proxy set <url>` or OTBOR_PROXY_URL",
      required: false
    })
  }

  const harnessPath = harnessStatePath()
  checks.push(
    existsSync(harnessPath)
      ? { name: "harness", state: "ok", detail: harnessPath, required: false }
      : {
          name: "harness",
          state: "warn",
          detail: "not registered",
          hint: "`otbor harness register --name <n> --save` (only for applying)",
          required: false
        }
  )

  const acpBin = process.env.OTBOR_ACP_BIN?.trim() || "opencode"
  const resolved = Bun.which(acpBin)
  checks.push(
    resolved !== null
      ? { name: "opencode", state: "ok", detail: resolved, required: false }
      : {
          name: "opencode",
          state: "warn",
          detail: `${acpBin} not on PATH`,
          hint: "install opencode or set OTBOR_ACP_BIN (needed for inference/writing jobs)",
          required: false
        }
  )

  return checks
})

const doctor = Command.make(
  "doctor",
  { json: Flag.Boolean("json").pipe(Flag.withDefault(false)) },
  Effect.fn(function*({ json }) {
    const checks = yield* doctorChecks()
    const code = doctorExitCode(checks)
    if (json) {
      yield* Console.log(JSON.stringify({ ok: code === 0, checks }, null, 2))
    } else {
      yield* Console.log(formatTable(checks))
      const hints = formatHints(checks)
      if (hints !== "") yield* Console.log(`\nhints:\n${hints}`)
      yield* Console.log(code === 0 ? "\nall required checks passed" : "\nsome required checks failed")
    }
    if (code !== 0) process.exitCode = 1
  })
).pipe(Command.withDescription("Check the local environment and say how to fix what is missing"))

export const upCommand = up
export const downCommand = down
export const statusCommand = status
export const doctorCommand = doctor
