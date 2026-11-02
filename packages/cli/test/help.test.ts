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

describe("otbor cli help", () => {
  test("root help lists acp and inference", () => {
    const help = cli("--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("acp")
    expect(help.out).toContain("inference")
  })

  test("acp help lists session and prompt", () => {
    const help = cli("acp", "--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("session")
    expect(help.out).toContain("prompt")
  })

  test("inference help lists run and get", () => {
    const help = cli("inference", "--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("run")
    expect(help.out).toContain("get")
  })

  test("inference run documents its flags", () => {
    const help = cli("inference", "run", "--help")
    expect(help.code).toBe(0)
    for (const flag of ["--system", "--model", "--account", "--timeout", "--no-wait", "--json"]) {
      expect(help.out).toContain(flag)
    }
  })

  test("root help lists the harness protocol", () => {
    const help = cli("--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("harness")
  })

  test("harness help lists register and run", () => {
    const help = cli("harness", "--help")
    expect(help.code).toBe(0)
    for (const command of ["register", "run", "lease", "heartbeat", "complete", "revoke"]) {
      expect(help.out).toContain(command)
    }
  })

  test("harness run documents the saved-registration flags", () => {
    const help = cli("harness", "run", "--help")
    expect(help.code).toBe(0)
    for (const flag of ["--harness", "--token", "--api-url", "--kind", "--account", "--wait", "--once"]) {
      expect(help.out).toContain(flag)
    }
    // The command documents that the saved registration is a fallback.
    expect(help.out).toContain("saved registration")
  })
})

/**
 * A real agent call is slow, costs tokens and needs an authenticated opencode,
 * so it is opt-in: `OTBOR_ACP_SMOKE=1 bun test packages/cli`.
 */
describe("acp prompt", () => {
  test.skipIf(
    process.env.OTBOR_ACP_SMOKE !== "1" || Bun.which("opencode") === null
  )("answers a trivial prompt through opencode acp", () => {
    const result = cli("acp", "prompt", "Reply with one short word.")
    expect(result.code).toBe(0)
    expect(result.out.trim().length).toBeGreaterThan(0)
  })
})
