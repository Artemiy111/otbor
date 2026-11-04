import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Schema } from "effect"

/**
 * One ACP agent the harness can start: a command, its arguments and the
 * environment tweaks that keep it on the right billing/login path.
 */
export interface AcpAgentDef {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** What the operator pays with, shown in the model picker (e.g. "subscription"). */
  readonly variant?: string
  /**
   * Prints `{"loggedIn": boolean}` JSON when run as `<command> <authCheck.args>`.
   * ACP sessions start without credentials, so this is how the catalog tells a
   * signed-out agent from a working one. Only `loggedIn: false` counts as signed out.
   */
  readonly authCheck?: { readonly args: ReadonlyArray<string>; readonly hint: string }
  /** Extra variables for the child process. */
  readonly env?: Readonly<Record<string, string>>
  /** Variables removed from the inherited environment. */
  readonly unsetEnv?: ReadonlyArray<string>
  /** `_meta` sent with `session/new` (agent-specific options). */
  readonly sessionMeta?: Readonly<Record<string, unknown>>
}

const AgentDefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  unsetEnv: Schema.optional(Schema.Array(Schema.String)),
  sessionMeta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  authCheck: Schema.optional(
    Schema.Struct({ args: Schema.Array(Schema.String), hint: Schema.String })
  )
})

export const DEFAULT_AGENT_ID = "opencode"

/**
 * Claude Code must run on the operator's own subscription (the local `claude`
 * login). An API key in the environment would silently switch the SDK to API
 * billing, so both credentials are removed from the child environment.
 */
export const CLAUDE_UNSET_ENV: ReadonlyArray<string> = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

/**
 * Text generation needs no tools. `disableBuiltInTools` removes every built-in
 * tool from the Claude Agent SDK session, so there is nothing to grant or deny.
 * The client additionally rejects any permission request that still arrives.
 */
export const CLAUDE_SESSION_META: Readonly<Record<string, unknown>> = {
  disableBuiltInTools: true,
  // The coding-agent persona is replaced: this session only writes text.
  systemPrompt:
    "You are a writing assistant. Follow the instructions in the user message exactly. " +
    "Use only the facts given in the message; never use anything you may know about the person running this program.",
  // Do not load the operator's own CLAUDE.md, memory or project settings: they describe
  // the operator, not the applicant, and leaked their name into a letter for someone else.
  claudeCode: { options: { settingSources: [] } }
}

/** Absolute path of the adapter's bin script inside node_modules, or null. */
export const resolveClaudeAdapterBin = (): string | null => {
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json")
    const pkg = require(pkgPath) as { readonly bin?: string | Readonly<Record<string, string>> }
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["claude-agent-acp"]
    return bin === undefined ? null : join(dirname(pkgPath), bin)
  } catch {
    return null
  }
}

export interface BuiltinAgentOptions {
  /** Binary for the `opencode` agent (`OTBOR_ACP_BIN`). */
  readonly opencodeBin?: string
  /** Override for the adapter script (tests). */
  readonly claudeAdapterBin?: string | null
}

export const builtinAgents = (options: BuiltinAgentOptions = {}): ReadonlyArray<AcpAgentDef> => {
  const adapter = options.claudeAdapterBin === undefined
    ? resolveClaudeAdapterBin()
    : options.claudeAdapterBin
  return [
    {
      id: "opencode",
      name: "OpenCode",
      command: options.opencodeBin ?? "opencode",
      args: ["acp"]
    },
    {
      id: "claude",
      name: "Claude Code",
      variant: "Claude subscription",
      // The adapter is a node script from node_modules: nothing is downloaded
      // at job time. A missing install becomes a clear spawn error.
      command: "node",
      args: [adapter ?? "claude-agent-acp-not-installed"],
      // `--cli` makes the adapter run the same native Claude Code binary the
      // session uses, so the answer is about the login the prompt will use.
      authCheck: {
        args: [adapter ?? "claude-agent-acp-not-installed", "--cli", "auth", "status"],
        hint: "run `claude auth login` as the user that runs the harness"
      },
      unsetEnv: CLAUDE_UNSET_ENV,
      sessionMeta: CLAUDE_SESSION_META
    }
  ]
}

export interface AgentRegistry {
  readonly agents: ReadonlyArray<AcpAgentDef>
  readonly defaultId: string
}

export interface AgentEnv {
  readonly OTBOR_ACP_BIN?: string | undefined
  readonly OTBOR_ACP_AGENTS?: string | undefined
  readonly OTBOR_ACP_DEFAULT_AGENT?: string | undefined
}

/**
 * Built-ins, then `OTBOR_ACP_AGENTS` (JSON array of defs; an entry with a known
 * id replaces it, a new id adds an agent). `OTBOR_ACP_BIN` keeps working: it is
 * the `opencode` binary, and `opencode` stays the default agent.
 */
export const resolveAgents = (
  env: AgentEnv,
  builtinOptions: BuiltinAgentOptions = {}
): AgentRegistry => {
  const bin = env.OTBOR_ACP_BIN?.trim()
  const byId = new Map<string, AcpAgentDef>()
  for (const agent of builtinAgents({
    ...builtinOptions,
    opencodeBin: bin !== undefined && bin.length > 0 ? bin : builtinOptions.opencodeBin
  })) {
    byId.set(agent.id, agent)
  }

  const raw = env.OTBOR_ACP_AGENTS?.trim()
  if (raw !== undefined && raw.length > 0) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (cause) {
      throw new Error(
        `OTBOR_ACP_AGENTS is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
    const defs = Schema.decodeUnknownSync(Schema.Array(AgentDefSchema))(json)
    for (const def of defs) {
      const previous = byId.get(def.id)
      byId.set(def.id, {
        id: def.id,
        name: def.name ?? previous?.name ?? def.id,
        variant: def.variant ?? previous?.variant,
        command: def.command,
        args: def.args ?? [],
        env: def.env,
        unsetEnv: def.unsetEnv ?? previous?.unsetEnv,
        sessionMeta: def.sessionMeta ?? previous?.sessionMeta,
        authCheck: def.authCheck ?? previous?.authCheck
      })
    }
  }

  const wanted = env.OTBOR_ACP_DEFAULT_AGENT?.trim()
  const defaultId = wanted !== undefined && byId.has(wanted) ? wanted : DEFAULT_AGENT_ID
  return { agents: Array.from(byId.values()), defaultId }
}

/** Child environment: inherit, drop the agent's secrets, add its own, mark the child. */
export const agentChildEnv = (
  agent: AcpAgentDef,
  base: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...base }
  for (const key of agent.unsetEnv ?? []) delete env[key]
  return { ...env, ...agent.env, OTBOR_ACP_CHILD: "1" }
}

/** `loggedIn: false` in the agent's own status output, or null when signed in or unknown. */
export const signedOutMessage = (agent: AcpAgentDef, stdout: string): string | null => {
  try {
    const status = JSON.parse(stdout) as { readonly loggedIn?: unknown }
    return status.loggedIn === false
      ? `${agent.name} is not signed in: ${agent.authCheck?.hint ?? "sign in first"}`
      : null
  } catch {
    return null
  }
}
