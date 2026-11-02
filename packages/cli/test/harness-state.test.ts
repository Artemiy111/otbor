import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  harnessStatePath,
  readHarnessState,
  writeHarnessState
} from "../src/harness-state.ts"

/**
 * The saved harness is a device credential: it lives outside the repo with
 * mode 0600. These tests use an explicit path, so nothing touches the real
 * `~/.otbor`.
 */
describe("harness state", () => {
  let dir: string
  let path: string
  let flatPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otbor-harness-state-"))
    path = join(dir, "nested", "harness.json")
    flatPath = join(dir, "harness.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("writes a saved harness and reads it back", () => {
    const state = {
      id: "harness-1",
      name: "laptop",
      token: "secret-token",
      apiUrl: "http://127.0.0.1:3001/rpc",
      kinds: ["browser", "inference"],
      accounts: ["account-1"]
    } as const

    expect(writeHarnessState(state, path)).toBe(path)
    expect(readHarnessState(path)).toEqual(state)
    // JSON on disk, not an opaque blob.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state)
  })

  test("creates the parent directory and keeps the file private", () => {
    const written = writeHarnessState(
      { id: "harness-2", name: "edge", token: "t" },
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
        id: "harness-3",
        token: "t",
        kinds: ["browser", 7, null],
        accounts: "not-an-array"
      })
    )
    const actual = readHarnessState(flatPath)
    expect(actual).toEqual({ id: "harness-3", name: "local", token: "t", kinds: ["browser"] })
  })

  test("a missing file is not an error", () => {
    expect(readHarnessState(join(dir, "absent.json"))).toBeNull()
  })

  test("invalid JSON names the path and the fix", () => {
    mkdirSync(join(dir, "nested"), { recursive: true })
    writeFileSync(path, "{not json")
    expect(() => readHarnessState(path)).toThrow(/invalid JSON/)
    expect(() => readHarnessState(path)).toThrow(/harness register --save/)
  })

  test("non-object JSON is rejected", () => {
    writeFileSync(flatPath, "[]")
    expect(() => readHarnessState(flatPath)).toThrow(/expected a JSON object/)
  })

  test("a state without an id or token is rejected", () => {
    writeFileSync(flatPath, JSON.stringify({ token: "t" }))
    expect(() => readHarnessState(flatPath)).toThrow(/missing harness id or token/)

    writeFileSync(flatPath, JSON.stringify({ id: "harness-4" }))
    expect(() => readHarnessState(flatPath)).toThrow(/missing harness id or token/)
  })

  test("harnessStatePath honors OTBOR_HARNESS_DIR and falls back to ~/.otbor", () => {
    expect(harnessStatePath({ OTBOR_HARNESS_DIR: "/var/empty/otbor" })).toBe(
      join("/var/empty/otbor", "harness.json")
    )
    expect(harnessStatePath({})).toBe(join(homedir(), ".otbor", "harness.json"))
    // Blank values are not a directory.
    expect(harnessStatePath({ OTBOR_HARNESS_DIR: "  " })).toBe(
      join(homedir(), ".otbor", "harness.json")
    )
  })
})
