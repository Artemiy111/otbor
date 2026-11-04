import {
  AcpClient,
  AcpError,
  AcpUnavailable,
  type AcpConfigOption,
  type AcpEvent,
  type AcpSessionInfo,
  findEffortOption,
  findModelOption
} from "@otbor/acp"
import {
  type HarnessExit,
  type InferencePayload,
  InferencePayload as InferencePayloadSchema
} from "@otbor/contract"
import { Effect, Schema, Stream } from "effect"

/**
 * The harness reports failures as a typed exit, never as a crash: the cloud
 * needs to retry or ask a human, so every ACP problem becomes
 * `inference_failed` with a message.
 */
export class InferenceFailed extends Schema.TaggedError<InferenceFailed>()(
  "InferenceFailed",
  {
    message: Schema.String
  }
) {}

export interface InferenceArtifacts extends Record<string, unknown> {
  readonly text: string
  readonly model: string | null
  /** Effort actually in use; null when the agent has no effort option. */
  readonly effort: string | null
  readonly usage: unknown
  readonly providerResponse: unknown
  readonly durationMs: number
}

export const decodeInferencePayload = (payload: unknown) =>
  Schema.decodeUnknownEffect(InferencePayloadSchema)(payload).pipe(
    Effect.mapError(
      (error) =>
        new InferenceFailed({
          message: `invalid inference payload: ${error.message}`
        })
    )
  )

/** The agent id a raw job payload asks for, read before the payload is decoded. */
export const payloadHarness = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null || !("harness" in payload)) {
    return undefined
  }
  const harness = payload.harness
  return typeof harness === "string" && harness.trim().length > 0 ? harness.trim() : undefined
}

const choices = (option: AcpConfigOption): string =>
  (option.options ?? []).map((value) => value.value).join(", ")

/**
 * Pick `value` on a select option, or fail loudly. There is no fallback to
 * another model or effort: the operator chose this one on purpose.
 */
const selectOption = Effect.fnUntraced(function*(
  acp: AcpClient["Service"],
  what: "model" | "effort",
  option: AcpConfigOption | undefined,
  value: string,
  context: string
): Effect.fn.Return<void, InferenceFailed | AcpError | AcpUnavailable> {
  if (option === undefined || (what === "effort" && (option.options ?? []).length === 0)) {
    return yield* new InferenceFailed({
      message: `cannot select ${what} "${value}": ${context} exposes no ${what} option`
    })
  }
  const offered = option.options ?? []
  if (offered.length > 0 && !offered.some((candidate) => candidate.value === value)) {
    return yield* new InferenceFailed({
      message: `${what} "${value}" is not offered by ${context}; available: ${choices(option)}`
    })
  }
  if (option.currentValue === value) return
  yield* acp.setConfigOption(option.id, value).pipe(
    Effect.mapError(
      (error) =>
        new InferenceFailed({
          message: `could not select ${what} "${value}" on ${context}: ${error.message}`
        })
    )
  )
})

/**
 * Select the requested model, then the effort. Order matters: Claude Code and
 * OpenCode list different effort levels per model, so the effort option is read
 * again after the model switch. Returns what the session is using afterwards.
 */
export const selectModelAndEffort = Effect.fnUntraced(function*(
  acp: AcpClient["Service"],
  payload: Pick<InferencePayload, "model" | "effort" | "harness">
): Effect.fn.Return<
  { readonly model: string | null; readonly effort: string | null },
  InferenceFailed | AcpError | AcpUnavailable
> {
  const info = yield* acp.session
  const context = `agent "${payload.harness ?? info.agent.name ?? "default"}"`
  const model = payload.model?.trim()
  const effort = payload.effort?.trim()

  if (model !== undefined && model.length > 0) {
    yield* selectOption(acp, "model", findModelOption(info.configOptions), model, context)
  }
  if (effort !== undefined && effort.length > 0) {
    const current = yield* acp.session
    yield* selectOption(
      acp,
      "effort",
      findEffortOption(current.configOptions),
      effort,
      `${context} with model "${findModelOption(current.configOptions)?.currentValue ?? model ?? "default"}"`
    )
  }

  const final = yield* acp.session
  return {
    model: findModelOption(final.configOptions)?.currentValue ?? null,
    effort: findEffortOption(final.configOptions)?.currentValue ?? null
  }
})

/**
 * ACP has no separate system-prompt slot in `session/prompt`, and this adapter
 * does not own the agent. The system text and an optional JSON schema are
 * therefore prepended to the single prompt the agent receives.
 */
export const inferencePrompt = (payload: InferencePayload): string => {
  const parts: Array<string> = []
  const system = payload.system?.trim()
  if (system !== undefined && system.length > 0) parts.push(system)
  parts.push(payload.prompt)
  if (payload.jsonSchema !== undefined) {
    parts.push(
      `Respond with JSON only, matching this schema:\n${JSON.stringify(payload.jsonSchema)}`
    )
  }
  return parts.join("\n\n")
}

const isDone = (event: AcpEvent): event is Extract<AcpEvent, { readonly _tag: "Done" }> =>
  event._tag === "Done"

/**
 * One ACP prompt, one Done event, no tools. The requested model and effort are
 * selected first (an impossible choice fails the job); the artifacts record
 * what the session is actually using.
 */
export const runAcpPrompt = Effect.fn("Harness.runAcpPrompt")(
  function*(
    payload: InferencePayload
  ): Effect.fn.Return<
    InferenceArtifacts,
    InferenceFailed | AcpError | AcpUnavailable,
    AcpClient
  > {
    const acp = yield* AcpClient
    const selected = yield* selectModelAndEffort(acp, payload)
    const events = yield* Stream.runCollect(acp.promptEvents(inferencePrompt(payload)))
    const done = Array.from(events).find(isDone)

    if (done === undefined) {
      return yield* new InferenceFailed({
        message: "ACP prompt finished without a Done event"
      })
    }

    const artifacts: InferenceArtifacts = {
      text: done.text.trim(),
      model: selected.model,
      effort: selected.effort,
      usage: done.providerUsage ?? done.usage,
      providerResponse: done.providerResponse,
      durationMs: done.durationMs
    }
    return artifacts
  },
  Effect.mapError((error: InferenceFailed | AcpError | AcpUnavailable) =>
    error._tag === "InferenceFailed"
      ? error
      : new InferenceFailed({ message: error.message })
  )
)

/** Decode the job payload and turn every ACP outcome into a harness exit. */
export const runInferenceExit = Effect.fn("Harness.runInferenceExit")(
  function*(
    payload: unknown
  ): Effect.fn.Return<HarnessExit, InferenceFailed, AcpClient> {
    const decoded = yield* decodeInferencePayload(payload)
    const artifacts = yield* runAcpPrompt(decoded)
    return { tag: "prepared", artifacts }
  },
  Effect.catchTag("InferenceFailed", (error) =>
    Effect.succeed<HarnessExit>({
      tag: "inference_failed",
      message: error.message
    })
  )
)
