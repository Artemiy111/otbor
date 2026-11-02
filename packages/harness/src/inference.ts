import { AcpClient, AcpError, AcpUnavailable, type AcpEvent, type AcpSessionInfo } from "@otbor/acp"
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

const sessionModel = (session: AcpSessionInfo): string | null =>
  session.configOptions.find((option) => option.id === "model")?.currentValue ?? null

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
 * One ACP prompt, one Done event, no tools. The model recorded in the artifacts
 * is the one the session is actually using; `payload.model` is only a fallback
 * because `AcpClient` exposes no model-selection call.
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
    const requestedModel = payload.model?.trim()
    if (requestedModel !== undefined && requestedModel.length > 0) {
      yield* acp.setConfigOption("model", requestedModel).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `ACP model ${requestedModel} could not be selected: ${error.message}`
          )
        )
      )
    }
    const session = yield* acp.session
    const events = yield* Stream.runCollect(acp.promptEvents(inferencePrompt(payload)))
    const done = Array.from(events).find(isDone)

    if (done === undefined) {
      return yield* new InferenceFailed({
        message: "ACP prompt finished without a Done event"
      })
    }

    const artifacts: InferenceArtifacts = {
      text: done.text.trim(),
      model: sessionModel(session) ?? requestedModel ?? null,
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
