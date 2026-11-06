import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const entry = join(import.meta.dirname, "..", "src", "main.ts")

const cli = (...args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, entry, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, OTBOR_API_URL: "http://127.0.0.1:1/rpc" }
  })
  return {
    code: result.exitCode,
    out: result.stdout.toString(),
    err: result.stderr.toString()
  }
}

describe("otbor write help", () => {
  test("root help lists write", () => {
    const help = cli("--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("write")
  })

  test("write help lists draft and resume", () => {
    const help = cli("write", "--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("draft")
    expect(help.out).toContain("resume")
  })

  test("write draft documents its flags", () => {
    const help = cli("write", "draft", "--help")
    expect(help.code).toBe(0)
    for (const flag of ["--length", "--save", "--harness", "--model", "--effort", "--timeout", "--no-wait", "--json"]) {
      expect(help.out).toContain(flag)
    }
  })

  test("write resume documents the target role and shared flags", () => {
    const help = cli("write", "resume", "--help")
    expect(help.code).toBe(0)
    for (const flag of [
      "--target-role",
      "--language",
      "--model",
      "--timeout",
      "--no-wait",
      "--json"
    ]) {
      expect(help.out).toContain(flag)
    }
  })
})
