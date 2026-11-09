import * as acp from "@agentclientprotocol/sdk"
import {
  Cause,
  Config,
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Stream
} from "effect"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { Readable, Writable } from "node:stream"
import {
  type AcpAgentDef,
  type AgentRegistry,
  agentChildEnv,
  resolveAgents,
  signedOutMessage
} from "./agents.ts"

export class AcpError extends Schema.TaggedError<AcpError>()("AcpError", {
  message: Schema.String
}) {}

export class AcpUnavailable extends Schema.TaggedError<AcpUnavailable>()("AcpUnavailable", {
  message: Schema.String
}) {}

export interface AcpOptions {
  readonly agent: AcpAgentDef
  readonly cwd: string
  readonly timeout: Duration.Input
}

/** One selectable ACP session option (model, effort, mode, ...). */
export interface AcpConfigOptionValue {
  readonly value: string
  readonly name?: string
  readonly description?: string
}

export interface AcpConfigOption {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly category?: string
  readonly type?: string
  readonly currentValue?: string
  readonly options?: ReadonlyArray<AcpConfigOptionValue>
}

export interface AcpAgentInfo {
  readonly name?: string
  readonly version?: string
}

/** Session metadata returned by `session/new`. */
export interface AcpSessionInfo {
  readonly sessionId: string
  readonly protocolVersion: number
  readonly agent: AcpAgentInfo
  readonly configOptions: ReadonlyArray<AcpConfigOption>
}

/** Картинка в запросе: base64 без префикса `data:` и её MIME-тип. */
export interface AcpImage {
  readonly data: string
  readonly mimeType: string
}

/** A single streamed event from one ACP prompt. */
export type AcpEvent =
  | {
      readonly _tag: "Chunk"
      readonly text: string
      readonly atMs: number
    }
  | {
      readonly _tag: "Done"
      readonly text: string
      readonly sessionId: string
      readonly stopReason: string
      readonly usage: unknown
      /** Raw `session/prompt` result from the agent (keeps vendor extensions). */
      readonly providerResponse: unknown
      /** Non-standard usage extension, e.g. opencode token counts. */
      readonly providerUsage: unknown
      readonly durationMs: number
    }

/**
 * ACP client built on the official `@agentclientprotocol/sdk`.
 *
 * The SDK owns JSON-RPC framing, schema validation, request ids and session
 * update routing. This module only adapts it to Effect: the child process is an
 * `Effect.acquireRelease` resource, SDK promises go through `Effect.tryPromise`,
 * and `ActiveSession.nextUpdate()` is exposed as a `Stream`.
 */
export class AcpClient extends Context.Service<
  AcpClient,
  {
    readonly prompt: (text: string) => Effect.Effect<string, AcpError | AcpUnavailable>
    readonly promptEvents: (
      text: string,
      images?: ReadonlyArray<AcpImage>
    ) => Stream.Stream<AcpEvent, AcpError | AcpUnavailable>
    readonly sessionId: Effect.Effect<string, AcpError | AcpUnavailable>
    /** Model, effort, mode and agent info captured at `session/new`. */
    readonly session: Effect.Effect<AcpSessionInfo, AcpError | AcpUnavailable>
    /** Change a session config option such as `model` or `effort`. */
    readonly setConfigOption: (
      id: string,
      value: string
    ) => Effect.Effect<void, AcpError | AcpUnavailable>
  }
>()("otbor/acp/AcpClient") {
  /**
   * The default agent (`opencode`, or `OTBOR_ACP_BIN` / `OTBOR_ACP_DEFAULT_AGENT`).
   * A missing or unauthenticated agent must not take the whole server down:
   * descriptions fall back to a template instead.
   */
  static readonly layer = Layer.unwrap(
    Effect.map(Effect.suspend(() => agentLayerConfig(undefined)), (live) =>
      live.pipe(
        Layer.catchCause((cause) =>
          Layer.mergeAll(
            Layer.effectDiscard(
              Effect.logWarning("ACP is unavailable; descriptions will fall back", cause)
            ),
            Layer.succeed(AcpClient)(
              AcpClient.of({
                prompt: () =>
                  Effect.fail(new AcpUnavailable({ message: "ACP is unavailable" })),
                promptEvents: () =>
                  Stream.fail(new AcpUnavailable({ message: "ACP is unavailable" })),
                sessionId: Effect.fail(
                  new AcpUnavailable({ message: "ACP is unavailable" })
                ),
                session: Effect.fail(new AcpUnavailable({ message: "ACP is unavailable" })),
                setConfigOption: () =>
                  Effect.fail(new AcpUnavailable({ message: "ACP is unavailable" }))
              })
            )
          )
        )
      )
    )
  )

  /**
   * A session on the named agent (default agent when `agentId` is undefined).
   * Unlike `layer`, failures are not swallowed: the caller reports why the
   * agent could not run, instead of silently using something else.
   */
  static readonly layerFor = (agentId: string | undefined) =>
    Layer.unwrap(Effect.suspend(() => agentLayerConfig(agentId)))

  /** Useful when ACP is disabled: every prompt fails with `AcpUnavailable`. */
  static readonly layerUnavailable = Layer.succeed(AcpClient)(
    AcpClient.of({
      prompt: () => Effect.fail(new AcpUnavailable({ message: "ACP is disabled" })),
      promptEvents: () => Stream.fail(new AcpUnavailable({ message: "ACP is disabled" })),
      sessionId: Effect.fail(new AcpUnavailable({ message: "ACP is disabled" })),
      session: Effect.fail(new AcpUnavailable({ message: "ACP is disabled" })),
      setConfigOption: () =>
        Effect.fail(new AcpUnavailable({ message: "ACP is disabled" }))
    })
  )
}

export interface AcpConfig {
  readonly registry: AgentRegistry
  readonly cwd: string
  readonly timeout: Duration.Duration
}

/** Agents, working directory and timeout from the `OTBOR_ACP_*` environment. */
export const loadAcpConfig = Effect.fnUntraced(function*() {
  const text = (name: string) => Config.String(name).pipe(Config.withDefault(""))
  const cwd = yield* Config.String("OTBOR_ACP_CWD").pipe(
    Config.withDefault(join(tmpdir(), "otbor-acp"))
  )
  const timeoutSeconds = yield* Config.Int("OTBOR_ACP_TIMEOUT_SECONDS").pipe(Config.withDefault(120))
  const env = {
    OTBOR_ACP_BIN: yield* text("OTBOR_ACP_BIN"),
    OTBOR_ACP_AGENTS: yield* text("OTBOR_ACP_AGENTS"),
    OTBOR_ACP_DEFAULT_AGENT: yield* text("OTBOR_ACP_DEFAULT_AGENT")
  }
  const registry = yield* Effect.try({
    try: () => resolveAgents(env),
    catch: (cause) =>
      new AcpUnavailable({ message: cause instanceof Error ? cause.message : String(cause) })
  })
  return { registry, cwd: resolve(cwd), timeout: Duration.seconds(timeoutSeconds) } satisfies AcpConfig
})

const agentLayerConfig = Effect.fnUntraced(function*(agentId: string | undefined) {
  const { registry, cwd, timeout } = yield* loadAcpConfig()
  const wanted = agentId?.trim() || registry.defaultId
  const agent = registry.agents.find((candidate) => candidate.id === wanted)
  if (agent === undefined) {
    return yield* new AcpUnavailable({
      message: `unknown ACP agent "${wanted}"; known: ${registry.agents.map((a) => a.id).join(", ")}`
    })
  }
  return Layer.effect(AcpClient, makeAcpClient({ agent, cwd, timeout }))
})

const acpError = (operation: string, cause: unknown) =>
  new AcpError({
    message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`
  })

const tryAcp = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => acpError(operation, cause)
  })

const spawnAcp = (options: AcpOptions) =>
  Effect.callback<ChildProcess, AcpUnavailable>((resume) => {
    const { agent } = options
    const label = [agent.command, ...agent.args].join(" ")
    const child = spawn(agent.command, [...agent.args], {
      cwd: options.cwd,
      env: agentChildEnv(agent) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"]
    })

    const onError = (cause: Error) =>
      resume(
        Effect.fail(
          new AcpUnavailable({
            message: `Unable to start ${agent.name} ("${label}"): ${cause.message}`
          })
        )
      )

    child.once("error", onError)
    child.once("spawn", () => {
      child.off("error", onError)
      resume(Effect.succeed(child))
    })

    return Effect.sync(() => {
      child.off("error", onError)
      if (child.pid === undefined) {
        child.kill()
      }
    })
  })

const stopChild = (child: ChildProcess) =>
  Effect.sync(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
    }
  })

const toConfigOptions = (
  options: ReadonlyArray<acp.SessionConfigOption>
): ReadonlyArray<AcpConfigOption> =>
  options.map((option) => {
    if (option.type === "boolean") {
      return {
        id: option.id,
        name: option.name,
        description: option.description ?? undefined,
        category: option.category ?? undefined,
        type: option.type,
        currentValue: String(option.currentValue)
      }
    }

    const values = option.options.flatMap((value) =>
      "group" in value ? value.options : [value]
    )

    return {
      id: option.id,
      name: option.name,
      description: option.description ?? undefined,
      category: option.category ?? undefined,
      type: option.type,
      currentValue: option.currentValue,
      options: values.map((value) => ({
        value: value.value,
        name: value.name,
        description: value.description ?? undefined
      }))
    }
  })

/** Start one agent process and a session on it; closed with the surrounding scope. */
export const makeAcpClient = Effect.fnUntraced(function*(options: AcpOptions) {
  yield* Effect.logDebug("Starting ACP agent", { agent: options.agent.id, cwd: options.cwd })

  // The ACP cwd may point at a dedicated temp directory. It must exist before
  // spawn, and keeping ACP outside the repo also prevents the nested opencode
  // process from discovering this project's MCP config.
  yield* Effect.tryPromise(() => mkdir(options.cwd, { recursive: true })).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Unable to create ACP working directory ${options.cwd}`, cause)
    )
  )

  const child = yield* Effect.acquireRelease(spawnAcp(options), stopChild)

  // Surface agent stderr in the server logs.
  const stderr = yield* Queue.unbounded<string>()
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onData = (chunk: Buffer) => {
        Queue.offerUnsafe(stderr, chunk.toString("utf8"))
      }
      child.stderr?.on("data", onData)
      return onData
    }),
    (onData) =>
      Effect.sync(() => {
        child.stderr?.off("data", onData)
      })
  )

  yield* Stream.fromQueue(stderr).pipe(
    Stream.map((line) => line.trim()),
    Stream.filter((line) => line.length > 0),
    Stream.runForEach((line) => Effect.logDebug(`[acp] ${line}`)),
    Effect.forkScoped
  )

  // Tee stdout before the SDK parses it. The SDK validates and strips unknown
  // response fields, but opencode puts token counts in a non-standard `usage`
  // property on the `session/prompt` result. Observing the raw bytes keeps that
  // vendor data without forking or patching the official SDK.
  const rawTap: { promptResponse: unknown } = { promptResponse: null }
  const rawDecoder = new TextDecoder()
  let rawBuffer = ""

  const inspectRaw = (chunk: Uint8Array) => {
    rawBuffer += rawDecoder.decode(chunk, { stream: true })
    let index = rawBuffer.indexOf("\n")
    while (index >= 0) {
      const line = rawBuffer.slice(0, index).trim()
      rawBuffer = rawBuffer.slice(index + 1)
      index = rawBuffer.indexOf("\n")
      if (line.length === 0) continue

      try {
        const message = JSON.parse(line) as {
          result?: { stopReason?: unknown }
        }
        if (typeof message.result?.stopReason === "string") {
          rawTap.promptResponse = message.result
        }
      } catch {
        // Not our business: the SDK will report malformed protocol data.
      }
    }
  }

  const tapping = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      inspectRaw(chunk)
      controller.enqueue(chunk)
    }
  })

  const output = Writable.toWeb(child.stdin!)
  const input = (Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>).pipeThrough(
    tapping
  )
  const transport = acp.ndJsonStream(output, input)

  const clientApp = acp
    .client({ name: "otbor" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      const offered = ctx.params.options
      // Description generation never needs tools. Deny anything that asks for
      // permission instead of silently granting shell/file access.
      const deny =
        offered.find((option) => option.kind === "reject_once") ??
        offered.find((option) => option.kind === "reject_always")

      return deny
        ? { outcome: { outcome: "selected", optionId: deny.optionId } }
        : { outcome: { outcome: "cancelled" } }
    })

  const connection = yield* Effect.acquireRelease(
    Effect.sync(() => clientApp.connect(transport)),
    (connection) => Effect.sync(() => connection.close())
  )

  // Resolves when stdout/transport closes; used to abort pending nextUpdate().
  const closed = yield* Deferred.make<void>()
  yield* Effect.forkScoped(
    Effect.promise(() => connection.closed).pipe(
      Effect.flatMap(() => Deferred.succeed(closed, void 0)),
      Effect.asVoid
    )
  )

  const initialized = yield* tryAcp("initialize", () =>
    connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: "otbor", version: "0.1.0" }
    })
  )

  const agent: AcpAgentInfo = {
    name: initialized.agentInfo?.name,
    version: initialized.agentInfo?.version
  }

  const session = yield* Effect.acquireRelease(
    tryAcp("session/new", () =>
      connection.agent
        .buildSession({
          cwd: options.cwd,
          mcpServers: [],
          ...(options.agent.sessionMeta === undefined
            ? {}
            : { _meta: { ...options.agent.sessionMeta } })
        })
        .start()
    ),
    (session) => Effect.sync(() => session.dispose())
  )

  const sessionId = session.sessionId
  const configOptionsRef = yield* Ref.make(
    toConfigOptions(session.newSessionResponse.configOptions ?? [])
  )

  const readSessionInfo = Effect.map(Ref.get(configOptionsRef), (configOptions): AcpSessionInfo => ({
    sessionId,
    protocolVersion: initialized.protocolVersion,
    agent,
    configOptions
  }))

  const configValue = (id: string) =>
    Ref.get(configOptionsRef).pipe(
      Effect.map(
        (options) => options.find((option) => option.id === id)?.currentValue ?? null
      )
    )

  yield* Effect.logInfo(
    `ACP ready: ${agent.name ?? "agent"} ${agent.version ?? ""}`.trim(),
    {
      sessionId,
      protocolVersion: initialized.protocolVersion,
      model: yield* configValue("model"),
      effort: yield* configValue("effort"),
      mode: yield* configValue("mode")
    }
  )

  const setConfigOption = (id: string, value: string) =>
    tryAcp("session/set_config_option", () =>
      connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: id,
        value
      })
    ).pipe(
      Effect.tap((response) =>
        Ref.set(configOptionsRef, toConfigOptions(response.configOptions))
      ),
      Effect.asVoid
    )

  const semaphore = yield* Semaphore.make(1)

  const promptEvents = (
    text: string,
    images: ReadonlyArray<AcpImage> = []
  ): Stream.Stream<AcpEvent, AcpError> =>
    Stream.unwrap(
      Effect.gen(function*() {
        yield* Semaphore.take(semaphore, 1)
        yield* Effect.addFinalizer(() => Semaphore.release(semaphore, 1))

        const queue = yield* Queue.unbounded<
          acp.ActiveSessionMessage,
          AcpError | Cause.Done
        >()
        const chunks = yield* Ref.make("")
        const chunkCount = yield* Ref.make(0)
        const usage = yield* Ref.make<unknown>(null)
        const startedAt = Date.now()
        rawTap.promptResponse = null

        // Route ActiveSession updates into an Effect queue.
        yield* Effect.forkScoped(
          Effect.gen(function*() {
            for (;;) {
              const message = yield* Effect.raceFirst(
                tryAcp("session/update", () => session.nextUpdate()),
                Deferred.await(closed).pipe(
                  Effect.flatMap(() =>
                    Effect.fail(new AcpError({ message: "ACP connection closed" }))
                  )
                )
              )

              yield* Queue.offer(queue, message)
              if (message.kind === "stop") {
                return yield* Queue.end(queue)
              }
            }
          }).pipe(Effect.catch((error) => Queue.fail(queue, error).pipe(Effect.asVoid)))
        )

        // Do not await prompt before reading updates: the SDK queues
        // `session/update` messages while the prompt request is in flight.
        yield* Effect.forkScoped(
          tryAcp("session/prompt", () => session.prompt(text)).pipe(
            Effect.timeoutOrElse({
              duration: options.timeout,
              orElse: () =>
                Effect.fail(new AcpError({ message: "ACP prompt request timed out" }))
            }),
            Effect.catch((error) => Queue.fail(queue, error).pipe(Effect.asVoid)),
            Effect.asVoid
          )
        )

        return Stream.fromQueue(queue).pipe(
          Stream.mapEffect((message) =>
            Effect.gen(function*() {
              if (message.kind === "session_update") {
                const update = message.update

                switch (update.sessionUpdate) {
                  case "agent_message_chunk": {
                    const content = update.content
                    if (content.type !== "text") {
                      return Option.none()
                    }
                    yield* Ref.update(chunks, (current) => current + content.text)
                    yield* Ref.update(chunkCount, (count) => count + 1)
                    return Option.some<AcpEvent>({
                      _tag: "Chunk",
                      text: content.text,
                      atMs: Date.now() - startedAt
                    })
                  }
                  case "usage_update": {
                    yield* Ref.set(usage, {
                      used: update.used,
                      size: update.size,
                      cost: update.cost ?? null
                    })
                    return Option.none()
                  }
                  case "config_option_update": {
                    yield* Effect.logDebug("ACP config option changed", update)
                    return Option.none()
                  }
                  default: {
                    yield* Effect.logDebug(`ACP update: ${update.sessionUpdate}`)
                    return Option.none()
                  }
                }
              }

              const count = yield* Ref.get(chunkCount)
              if (count === 0) {
                return yield* new AcpError({
                  message: `ACP prompt finished with stopReason "${message.stopReason}" but produced no text`
                })
              }

              const providerResponse = rawTap.promptResponse
              const providerUsage =
                providerResponse !== null &&
                typeof providerResponse === "object" &&
                "usage" in providerResponse
                  ? providerResponse.usage
                  : null

              return Option.some<AcpEvent>({
                _tag: "Done",
                text: yield* Ref.get(chunks),
                sessionId,
                stopReason: message.stopReason,
                usage: yield* Ref.get(usage),
                providerResponse,
                providerUsage,
                durationMs: Date.now() - startedAt
              })
            })
          ),
          Stream.filter(Option.isSome),
          Stream.map((event) => event.value)
        )
      })
    )

  const prompt = (text: string) =>
    Stream.runCollect(promptEvents(text)).pipe(
      Effect.flatMap((events) => {
        const done = Array.from(events).find((event) => event._tag === "Done")
        if (done === undefined || done._tag !== "Done") {
          return Effect.fail(new AcpError({ message: "ACP prompt produced no result" }))
        }
        const output = done.text.trim()
        return output.length === 0
          ? Effect.fail(
              new AcpError({
                message: `ACP prompt finished with stopReason "${done.stopReason}" but produced no text`
              })
            )
          : Effect.succeed(output)
      })
    )

  return AcpClient.of({
    prompt,
    promptEvents,
    sessionId: Effect.succeed(sessionId),
    session: readSessionInfo,
    setConfigOption
  })
})

// -- option discovery --------------------------------------------------------

const EFFORT_IDS = ["effort", "thought_level", "reasoning_effort", "reasoning"]

/** The model selector of a session: `category: "model"` or the id `model`. */
export const findModelOption = (
  options: ReadonlyArray<AcpConfigOption>
): AcpConfigOption | undefined =>
  options.find((option) => option.category === "model") ??
  options.find((option) => option.id === "model")

/** The effort / thinking-level selector: `thought_level` category or a known id. */
export const findEffortOption = (
  options: ReadonlyArray<AcpConfigOption>
): AcpConfigOption | undefined =>
  options.find((option) => option.category === "thought_level") ??
  options.find((option) => EFFORT_IDS.includes(option.id))

/**
 * Sign-in state of an agent that has an `authCheck`: a message when it is
 * signed out, null otherwise (signed in, no check, or the check itself failed).
 */
export const checkAgentLogin = (agent: AcpAgentDef): Effect.Effect<string | null> =>
  agent.authCheck === undefined
    ? Effect.succeed(null)
    : Effect.callback<string | null>((resume) => {
        const child = execFile(
          agent.command,
          [...agent.authCheck!.args],
          { env: agentChildEnv(agent) as NodeJS.ProcessEnv, timeout: 20_000 },
          (_error, stdout) => resume(Effect.succeed(signedOutMessage(agent, String(stdout))))
        )
        return Effect.sync(() => {
          child.kill()
        })
      })
