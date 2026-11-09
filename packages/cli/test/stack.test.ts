import { describe, expect, test } from "bun:test"
import {
  findStrayProcesses,
  banner,
  databaseAddress,
  doctorExitCode,
  endpoints,
  formatHints,
  formatTable,
  isPrivateMode,
  linePrefix,
  parsePid,
  pendingMigrations,
  pidFilePath,
  serviceSpecs,
  statusSummary,
  versionAtLeast,
  type Check
} from "../src/stack.ts"

describe("pid files", () => {
  test("parsePid accepts one positive integer", () => {
    expect(parsePid("123\n")).toBe(123)
    expect(parsePid("  42 ")).toBe(42)
    expect(parsePid("")).toBeNull()
    expect(parsePid("0")).toBeNull()
    expect(parsePid("-5")).toBeNull()
    expect(parsePid("12 34")).toBeNull()
    expect(parsePid("abc")).toBeNull()
  })

  test("pidFilePath", () => {
    expect(pidFilePath("server", "/run")).toBe("/run/server.pid")
  })
})

describe("services and endpoints", () => {
  test("serviceSpecs honours flags", () => {
    const names = (web: boolean, harness: boolean) =>
      serviceSpecs("/r", { web, harness }).map((spec) => spec.name)
    expect(names(true, false)).toEqual(["server", "worker", "web"])
    expect(names(false, false)).toEqual(["server", "worker"])
    expect(names(true, true)).toEqual(["server", "worker", "web", "harness"])
    expect(serviceSpecs("/r", { web: true, harness: false })[2]!.cwd).toBe("/r/apps/web")
  })

  test("endpoints respect HOST and PORT", () => {
    expect(endpoints({}).health).toBe("http://127.0.0.1:3001/health")
    expect(endpoints({ HOST: "0.0.0.0", PORT: "4000" }).api).toBe("http://127.0.0.1:4000/rpc")
    expect(endpoints({ PORT: "nope" }).port).toBe(3001)
  })

  test("databaseAddress reads DATABASE_URL", () => {
    expect(databaseAddress("postgres://o:o@localhost:55432/otbor")).toEqual({ host: "127.0.0.1", port: 55432 })
    expect(databaseAddress("postgres://o:o@db.internal/otbor")).toEqual({ host: "db.internal", port: 5432 })
    expect(databaseAddress(undefined).port).toBe(55432)
    expect(databaseAddress("garbage").port).toBe(55432)
  })
})

describe("formatting", () => {
  test("linePrefix pads and colors", () => {
    expect(linePrefix("web", 6, null)).toBe("web    | ")
    expect(linePrefix("web", 6, 36)).toBe("\u001b[36mweb    |\u001b[0m ")
  })

  test("banner lists web only when it runs", () => {
    const urls = { api: "A", health: "H", web: "W" }
    expect(banner(urls, ["server", "web"])).toContain("W")
    expect(banner(urls, ["server"])).not.toContain("W")
  })

  const checks: ReadonlyArray<Check> = [
    { name: "postgres", state: "ok", detail: "up" },
    { name: "api", state: "fail", detail: "down", hint: "run otbor up" },
    { name: "proxy", state: "warn", detail: "none", hint: "set it", required: false }
  ]

  test("formatTable aligns columns", () => {
    const lines = formatTable(checks).split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("postgres  ok    up")
    expect(lines[1]).toBe("api       FAIL  down")
  })

  test("formatHints lists failing and warning checks with hints", () => {
    expect(formatHints(checks)).toBe("  api: run otbor up\n  proxy: set it")
  })
})

describe("aggregation", () => {
  test("doctorExitCode ignores optional failures", () => {
    expect(doctorExitCode([{ name: "a", state: "ok", detail: "" }])).toBe(0)
    expect(doctorExitCode([{ name: "a", state: "fail", detail: "" }])).toBe(1)
    expect(doctorExitCode([{ name: "a", state: "fail", detail: "", required: false }])).toBe(0)
    expect(doctorExitCode([{ name: "a", state: "warn", detail: "" }])).toBe(0)
  })

  test("statusSummary", () => {
    const state = (postgres: Check["state"], api: Check["state"], worker: Check["state"]): Array<Check> => [
      { name: "postgres", state: postgres, detail: "" },
      { name: "api", state: api, detail: "" },
      { name: "worker", state: worker, detail: "" }
    ]
    expect(statusSummary(state("ok", "ok", "ok"))).toBe("up")
    expect(statusSummary(state("ok", "fail", "ok"))).toBe("degraded")
    expect(statusSummary(state("fail", "fail", "fail"))).toBe("down")
  })

  test("isPrivateMode", () => {
    expect(isPrivateMode(0o100600)).toBe(true)
    expect(isPrivateMode(0o100644)).toBe(false)
  })

  test("pendingMigrations", () => {
    const files = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }]
    expect(pendingMigrations(files, [1, 2, 3])).toEqual([])
    expect(pendingMigrations(files, [1])).toEqual(["2_b", "3_c"])
    expect(pendingMigrations(files, [])).toHaveLength(3)
  })

  test("versionAtLeast", () => {
    expect(versionAtLeast("1.4.4", "1.2.0")).toBe(true)
    expect(versionAtLeast("1.1.9", "1.2.0")).toBe(false)
    expect(versionAtLeast("2.0.0", "1.9.9")).toBe(true)
    expect(versionAtLeast("1.2.0", "1.2.0")).toBe(true)
  })
})

describe("findStrayProcesses", () => {
  const ps = [
    "36889 bun packages/cloud/src/worker.ts",
    "36891 bun packages/cli/src/main.ts harness run",
    "50830 bun /r/packages/cli/bin/../src/main.ts up",
    "55802 bun /r/packages/cli/bin/../src/main.ts mcp",
    "56014 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x"
  ].join("\n")

  test("находит worker и harness, оставшиеся от прошлого запуска", () => {
    const found = findStrayProcesses(ps, ["server", "worker", "harness"])
    expect(found.map((p) => [p.name, p.pid])).toEqual([["worker", 36889], ["harness", 36891]])
  })

  test("не трогает сервисы вне списка и собственный pid", () => {
    expect(findStrayProcesses(ps, ["server"])).toEqual([])
    expect(findStrayProcesses(ps, ["worker"], 36889)).toEqual([])
  })
})
