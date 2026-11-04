import { describe, expect, test } from "bun:test"
import {
  agentChildEnv,
  builtinAgents,
  findEffortOption,
  findModelOption,
  resolveAgents,
  resolveClaudeAdapterBin,
  signedOutMessage
} from "../src/index.ts"

describe("resolveAgents", () => {
  test("ships opencode and claude, opencode first and default", () => {
    const { agents, defaultId } = resolveAgents({})
    expect(agents.map((agent) => agent.id)).toEqual(["opencode", "claude"])
    expect(defaultId).toBe("opencode")
    expect(agents[0]).toMatchObject({ command: "opencode", args: ["acp"] })
  })

  test("OTBOR_ACP_BIN is the opencode binary", () => {
    const { agents } = resolveAgents({ OTBOR_ACP_BIN: "/opt/fake-agent" })
    expect(agents[0]).toMatchObject({ id: "opencode", command: "/opt/fake-agent", args: ["acp"] })
  })

  test("claude runs the installed adapter from node_modules", () => {
    const bin = resolveClaudeAdapterBin()
    expect(bin).not.toBeNull()
    expect(bin).toContain("node_modules")
    const claude = resolveAgents({}).agents.find((agent) => agent.id === "claude")!
    expect(claude.command).toBe("node")
    expect(claude.args).toEqual([bin!])
    expect(claude.sessionMeta).toMatchObject({
      disableBuiltInTools: true,
      // The operator's own CLAUDE.md and memory must not reach an applicant's letter.
      claudeCode: { options: { settingSources: [] } }
    })
    expect(typeof (claude.sessionMeta as { systemPrompt?: unknown }).systemPrompt).toBe("string")
  })

  test("OTBOR_ACP_AGENTS replaces a known agent and adds a new one", () => {
    const { agents } = resolveAgents({
      OTBOR_ACP_AGENTS: JSON.stringify([
        { id: "claude", command: "/x/claude-acp", args: ["--flag"] },
        { id: "gemini", name: "Gemini", command: "gemini", args: ["--acp"] }
      ]),
      OTBOR_ACP_DEFAULT_AGENT: "gemini"
    })
    const claude = agents.find((agent) => agent.id === "claude")!
    expect(claude).toMatchObject({ command: "/x/claude-acp", args: ["--flag"], name: "Claude Code" })
    // The credential stripping survives an override unless it is replaced.
    expect(claude.unsetEnv).toContain("ANTHROPIC_API_KEY")
    expect(agents.find((agent) => agent.id === "gemini")).toMatchObject({ name: "Gemini" })
    expect(resolveAgents({ OTBOR_ACP_AGENTS: "[]", OTBOR_ACP_DEFAULT_AGENT: "nope" }).defaultId)
      .toBe("opencode")
  })

  test("invalid OTBOR_ACP_AGENTS fails with a readable message", () => {
    expect(() => resolveAgents({ OTBOR_ACP_AGENTS: "{nope" })).toThrow("not valid JSON")
    expect(() => resolveAgents({ OTBOR_ACP_AGENTS: '[{"id":"x"}]' })).toThrow()
  })
})

describe("agentChildEnv", () => {
  const base = { ANTHROPIC_API_KEY: "sk-1", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin", HOME: "/h" }

  test("claude drops API credentials so the subscription login is used", () => {
    const claude = builtinAgents().find((agent) => agent.id === "claude")!
    const env = agentChildEnv(claude, base)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect("ANTHROPIC_API_KEY" in env).toBe(false)
    expect(env.PATH).toBe("/bin")
    expect(env.OTBOR_ACP_CHILD).toBe("1")
  })

  test("opencode keeps the inherited environment", () => {
    const opencode = builtinAgents().find((agent) => agent.id === "opencode")!
    const env = agentChildEnv(opencode, base)
    expect(env.ANTHROPIC_API_KEY).toBe("sk-1")
    expect(env.OTBOR_ACP_CHILD).toBe("1")
  })
})

describe("option discovery", () => {
  test("finds the model by category or id and the effort by thought_level or known ids", () => {
    const options = [
      { id: "mode", category: "mode" },
      { id: "m", category: "model" },
      { id: "effort", category: "thought_level" }
    ]
    expect(findModelOption(options)?.id).toBe("m")
    expect(findEffortOption(options)?.id).toBe("effort")
    expect(findModelOption([{ id: "model" }])?.id).toBe("model")
    expect(findEffortOption([{ id: "reasoning_effort" }])?.id).toBe("reasoning_effort")
    expect(findEffortOption([{ id: "mode" }])).toBeUndefined()
  })
})

describe("signedOutMessage", () => {
  const claude = builtinAgents().find((agent) => agent.id === "claude")!

  test("only an explicit loggedIn:false counts as signed out", () => {
    expect(signedOutMessage(claude, '{"loggedIn": false}')).toContain("not signed in")
    expect(signedOutMessage(claude, '{"loggedIn": true}')).toBeNull()
    expect(signedOutMessage(claude, "garbage")).toBeNull()
  })

  test("claude checks its login through the adapter's --cli passthrough", () => {
    expect(claude.authCheck?.args.slice(-3)).toEqual(["--cli", "auth", "status"])
    expect(claude.authCheck?.args).toContain("--cli")
  })
})
