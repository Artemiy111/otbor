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

  test("write help lists letter, answers and resume", () => {
    const help = cli("write", "--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("letter")
    expect(help.out).toContain("answers")
    expect(help.out).toContain("resume")
  })

  test("write letter documents its flags", () => {
    const help = cli("write", "letter", "--help")
    expect(help.code).toBe(0)
    for (const flag of ["--tone", "--length", "--save", "--model", "--timeout", "--no-wait", "--json"]) {
      expect(help.out).toContain(flag)
    }
  })

  test("write answers documents repeatable questions and save", () => {
    const help = cli("write", "answers", "--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("--question")
    expect(help.out).toContain("--save")
  })

  test("write resume documents the target role and shared flags", () => {
    const help = cli("write", "resume", "--help")
    expect(help.code).toBe(0)
    for (const flag of ["--target-role", "--model", "--timeout", "--no-wait", "--json"]) {
      expect(help.out).toContain(flag)
    }
  })
})
