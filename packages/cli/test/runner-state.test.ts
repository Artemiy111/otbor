import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  runnerStatePath,
  readRunnerState,
  writeRunnerState
} from "../src/runner-state.ts"

/**
 * The saved runner is a device credential: it lives outside the repo with
 * mode 0600. These tests use an explicit path, so nothing touches the real
 * `~/.otbor`.
 */
describe("runner state", () => {
  let dir: string
  let path: string
  let flatPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otbor-runner-state-"))
    path = join(dir, "nested", "runner.json")
    flatPath = join(dir, "runner.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("writes a saved runner and reads it back", () => {
    const state = {
      id: "runner-1",
      name: "laptop",
      token: "secret-token",
      apiUrl: "http://127.0.0.1:3001/rpc",
      kinds: ["browser", "inference"],
      accounts: ["account-1"]
    } as const

    expect(writeRunnerState(state, path)).toBe(path)
    expect(readRunnerState(path)).toEqual(state)
    // JSON on disk, not an opaque blob.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state)
  })

  test("creates the parent directory and keeps the file private", () => {
    const written = writeRunnerState(
      { id: "runner-2", name: "edge", token: "t" },
      path
    )
    expect(written).toBe(path)

    const mode = statSync(path).mode & 0o777
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600)
    }

    const dirMode = statSync(join(dir, "nested")).mode & 0o777
    if (process.platform !== "win32") {
      // mkdir mode is filtered by the umask, but it must not be world-writable.
      expect(dirMode & 0o077).toBe(0)
    }
  })

  test("defaults the name and drops unknown or malformed optional fields", () => {
    writeFileSync(
      flatPath,
      JSON.stringify({
        id: "runner-3",
        token: "t",
        kinds: ["browser", 7, null],
        accounts: "not-an-array"
      })
    )
    const actual = readRunnerState(flatPath)
    expect(actual).toEqual({ id: "runner-3", name: "local", token: "t", kinds: ["browser"] })
  })

  test("a missing file is not an error", () => {
    expect(readRunnerState(join(dir, "absent.json"))).toBeNull()
  })

  test("invalid JSON names the path and the fix", () => {
    mkdirSync(join(dir, "nested"), { recursive: true })
    writeFileSync(path, "{not json")
    expect(() => readRunnerState(path)).toThrow(/invalid JSON/)
    expect(() => readRunnerState(path)).toThrow(/runner register --save/)
  })

  test("non-object JSON is rejected", () => {
    writeFileSync(flatPath, "[]")
    expect(() => readRunnerState(flatPath)).toThrow(/expected a JSON object/)
  })

  test("a state without an id or token is rejected", () => {
    writeFileSync(flatPath, JSON.stringify({ token: "t" }))
    expect(() => readRunnerState(flatPath)).toThrow(/missing runner id or token/)

    writeFileSync(flatPath, JSON.stringify({ id: "runner-4" }))
    expect(() => readRunnerState(flatPath)).toThrow(/missing runner id or token/)
  })

  test("runnerStatePath honors OTBOR_RUNNER_DIR and falls back to ~/.otbor", () => {
    expect(runnerStatePath({ OTBOR_RUNNER_DIR: "/var/empty/otbor" })).toBe(
      join("/var/empty/otbor", "runner.json")
    )
    expect(runnerStatePath({})).toBe(join(homedir(), ".otbor", "runner.json"))
    // Blank values are not a directory.
    expect(runnerStatePath({ OTBOR_RUNNER_DIR: "  " })).toBe(
      join(homedir(), ".otbor", "runner.json")
    )
  })
})
