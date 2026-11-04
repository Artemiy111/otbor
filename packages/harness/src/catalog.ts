import {
  type AcpAgentDef,
  type AcpClient,
  type AcpConfigOption,
  checkAgentLogin,
  findEffortOption,
  findModelOption,
  loadAcpConfig,
  makeAcpClient
} from "@otbor/acp"
import type { AgentHarness, AgentModel } from "@otbor/contract"
import { type Cause, Duration, Effect } from "effect"

/** `default` is the agent's "no explicit choice" row, not a level to pick. */
const UNPINNED = "default"

export const effortsOf = (option: AcpConfigOption | undefined): ReadonlyArray<string> =>
  (option?.options ?? []).map((value) => value.value).filter((value) => value !== UNPINNED)

/**
 * One model of the catalog. `effortOption` is the effort selector as the agent
 * reports it while this model is selected: some agents (Claude Code, OpenCode)
 * offer different levels per model, so it is read after selecting each model.
 */
export const toAgentModel = (
  value: { readonly value: string; readonly name?: string },
  effortOption: AcpConfigOption | undefined,
  variant: string | undefined
): AgentModel => {
  const current = effortOption?.currentValue
  return {
    id: value.value,
    label: value.name ?? value.value,
    efforts: effortsOf(effortOption),
    defaultEffort: current !== undefined && current !== UNPINNED ? current : null,
    variant: variant ?? null
  }
}

export const agentHarness = (
  agent: Pick<AcpAgentDef, "id" | "name">,
  models: ReadonlyArray<AgentModel>,
  defaultModel: string | null
): AgentHarness => ({
  id: agent.id,
  name: agent.name,
  available: true,
  error: null,
  models,
  defaultModel
})

export const unavailableHarness = (
  agent: Pick<AcpAgentDef, "id" | "name">,
  error: string
): AgentHarness => ({
  id: agent.id,
  name: agent.name,
  available: false,
  error,
  models: [],
  defaultModel: null
})

/**
 * Read what a started session can run. Selecting a model only changes session
 * config (no prompt is sent, so no model call and no cost). A model the agent
 * refuses to select is left out: offering it would only fail the job later.
 */
export const probeClient = Effect.fnUntraced(function*(
  client: AcpClient["Service"],
  agent: Pick<AcpAgentDef, "id" | "name" | "variant">
): Effect.fn.Return<AgentHarness, never> {
  const exit = yield* Effect.gen(function*() {
    const session = yield* client.session
    const modelOption = findModelOption(session.configOptions)
    if (modelOption === undefined) {
      return unavailableHarness(agent, "the agent exposes no model option")
    }

    const original = modelOption.currentValue ?? null
    const models: Array<AgentModel> = []
    for (const value of modelOption.options ?? []) {
      const selected = yield* client.setConfigOption(modelOption.id, value.value).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logWarning(
            `${agent.id}: model ${value.value} cannot be selected: ${error.message}`
          ).pipe(Effect.as(false))
        )
      )
      if (!selected) continue
      const current = yield* client.session
      models.push(toAgentModel(value, findEffortOption(current.configOptions), agent.variant))
    }
    return agentHarness(
      agent,
      models,
      original !== null && models.some((model) => model.id === original)
        ? original
        : (models[0]?.id ?? null)
    )
  }).pipe(Effect.result)

  return exit._tag === "Success"
    ? exit.success
    : unavailableHarness(agent, exit.failure.message)
})

export interface ProbeOptions {
  readonly cwd: string
  readonly timeout: Duration.Input
  /** The whole probe of one agent (start, login check, model sweep). */
  readonly startTimeout?: Duration.Input
}

/** Start the agent, read its catalog and stop it. Never fails. */
export const probeAgent = (
  agent: AcpAgentDef,
  options: ProbeOptions
): Effect.Effect<AgentHarness> =>
  checkAgentLogin(agent).pipe(
    Effect.flatMap((signedOut) =>
      signedOut !== null
        ? Effect.succeed(unavailableHarness(agent, signedOut))
        : Effect.scoped(
            makeAcpClient({ agent, cwd: options.cwd, timeout: options.timeout }).pipe(
              Effect.flatMap((client) => probeClient(client, agent))
            )
          )
    )
  ).pipe(
    Effect.timeoutOrElse({
      duration: options.startTimeout ?? Duration.seconds(60),
      orElse: () =>
        Effect.succeed(unavailableHarness(agent, "the agent did not answer in time"))
    }),
    Effect.catchCause((cause) =>
      Effect.succeed(unavailableHarness(agent, causeMessage(cause)))
    )
  )

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const failure = cause.reasons.find((reason) => reason._tag === "Fail")
  const error = failure?._tag === "Fail" ? failure.error : undefined
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { readonly message: unknown }).message)
  }
  return error === undefined ? "the agent could not be probed" : String(error)
}

/** Probe every configured agent, one after the other (each is a child process). */
export const probeCatalog = Effect.fn("Harness.probeCatalog")(function*(): Effect.fn.Return<
  ReadonlyArray<AgentHarness>
> {
  const config = yield* loadAcpConfig().pipe(Effect.result)
  if (config._tag === "Failure") {
    yield* Effect.logWarning(`ACP catalog: invalid configuration: ${config.failure.message}`)
    return []
  }
  const { registry, cwd, timeout } = config.success
  const harnesses: Array<AgentHarness> = []
  for (const agent of registry.agents) {
    harnesses.push(yield* probeAgent(agent, { cwd, timeout }))
  }
  return harnesses
})
