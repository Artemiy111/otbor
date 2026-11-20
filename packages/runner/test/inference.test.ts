import { AcpClient, AcpError, type AcpEvent, type AcpSessionInfo } from "@otbor/acp"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import {
  decodeInferencePayload,
  inferencePrompt,
  payloadHarness,
  runAcpPrompt,
  runInferenceExit
} from "../src/inference.ts"

const session: AcpSessionInfo = {
  sessionId: "session-1",
  protocolVersion: 1,
  agent: { name: "fake" },
  configOptions: [{ id: "model", currentValue: "fake/model" }]
}

const doneEvent = (overrides: Partial<Extract<AcpEvent, { _tag: "Done" }>> = {}): AcpEvent => ({
  _tag: "Done",
  text: "  answer  ",
  sessionId: "session-1",
  stopReason: "end_turn",
  usage: { used: 10, size: 100, cost: null },
  providerResponse: { stopReason: "end_turn", usage: { input_tokens: 3 } },
  providerUsage: { input_tokens: 3, output_tokens: 2 },
  durationMs: 42,
  ...overrides
})

const acpLayer = (
  events: ReadonlyArray<AcpEvent>,
  info: AcpSessionInfo = session
): Layer.Layer<AcpClient> =>
  Layer.succeed(AcpClient)(
    AcpClient.of({
      prompt: () => Effect.succeed("answer"),
      promptEvents: () => Stream.fromIterable(events),
      sessionId: Effect.succeed(info.sessionId),
      session: Effect.succeed(info),
      setConfigOption: () => Effect.void
    })
  )

const failingAcpLayer = (message: string): Layer.Layer<AcpClient> =>
  Layer.succeed(AcpClient)(
    AcpClient.of({
      prompt: () => Effect.fail(new AcpError({ message })),
      promptEvents: () => Stream.fail(new AcpError({ message })),
      sessionId: Effect.fail(new AcpError({ message })),
      session: Effect.fail(new AcpError({ message })),
      setConfigOption: () => Effect.fail(new AcpError({ message }))
    })
  )

describe("decodeInferencePayload", () => {
  test("decodes a prompt with system, model and schema", async () => {
    const payload = await Effect.runPromise(
      decodeInferencePayload({
        prompt: "write a letter",
        system: "be brief",
        model: "fake/model",
        jsonSchema: { type: "object" }
      })
    )

    expect(payload.prompt).toBe("write a letter")
    expect(payload.system).toBe("be brief")
    expect(payload.model).toBe("fake/model")
    expect(payload.jsonSchema).toEqual({ type: "object" })
  })

  test("rejects a payload without a prompt", async () => {
    const error = await Effect.runPromise(
      decodeInferencePayload({ system: "be brief" }).pipe(Effect.flip)
    )

    expect(error._tag).toBe("InferenceFailed")
    expect(error.message).toContain("invalid inference payload")
  })

  test("rejects a payload that is not an object", async () => {
    const error = await Effect.runPromise(decodeInferencePayload("prompt").pipe(Effect.flip))
    expect(error._tag).toBe("InferenceFailed")
  })
})

describe("inferencePrompt", () => {
  test("sends the prompt unchanged when there is no system or schema", () => {
    expect(inferencePrompt({ prompt: "hello" })).toBe("hello")
  })

  test("puts the system prompt, prompt and JSON schema in one ACP prompt", () => {
    const text = inferencePrompt({
      prompt: "hello",
      system: "be brief",
      jsonSchema: { type: "object" }
    })

    expect(text).toContain("be brief")
    expect(text).toContain("hello")
    expect(text).toContain("Respond with JSON only")
    expect(text).toContain('{"type":"object"}')
  })
})

describe("runAcpPrompt", () => {
  test("collects the Done event into inference artifacts", async () => {
    const artifacts = await Effect.runPromise(
      runAcpPrompt({ prompt: "hello" }).pipe(Effect.provide(acpLayer([doneEvent()])))
    )

    expect(artifacts).toEqual({
      text: "answer",
      model: "fake/model",
      effort: null,
      usage: { input_tokens: 3, output_tokens: 2 },
      providerResponse: { stopReason: "end_turn", usage: { input_tokens: 3 } },
      durationMs: 42
    })
  })

  test("fails instead of falling back when the agent has no model option", async () => {
    const error = await Effect.runPromise(
      runAcpPrompt({ prompt: "hello", model: "requested/model" }).pipe(
        Effect.provide(acpLayer([doneEvent()], { ...session, configOptions: [] })),
        Effect.flip
      )
    )

    expect(error.message).toContain('cannot select model "requested/model"')
  })

  test("applies the requested model through session config", async () => {
    const configured: Array<readonly [string, string]> = []
    const layer = Layer.succeed(AcpClient)(
      AcpClient.of({
        prompt: () => Effect.succeed("answer"),
        promptEvents: () => Stream.fromIterable([doneEvent()]),
        sessionId: Effect.succeed(session.sessionId),
        session: Effect.succeed(session),
        setConfigOption: (id, value) => {
          configured.push([id, value])
          return Effect.void
        }
      })
    )

    await Effect.runPromise(
      runAcpPrompt({ prompt: "hello", model: "requested/model" }).pipe(
        Effect.provide(layer)
      )
    )

    expect(configured).toEqual([["model", "requested/model"]])
  })

  test("fails when the agent produces no Done event", async () => {
    const error = await Effect.runPromise(
      runAcpPrompt({ prompt: "hello" }).pipe(
        Effect.provide(
          acpLayer([{ _tag: "Chunk", text: "partial", atMs: 1 }])
        ),
        Effect.flip
      )
    )

    expect(error.message).toContain("without a Done event")
  })

  test("passes the composed system and schema text to the agent", async () => {
    let seen = ""
    const layer = Layer.succeed(AcpClient)(
      AcpClient.of({
        prompt: () => Effect.succeed("answer"),
        promptEvents: (text) => {
          seen = text
          return Stream.fromIterable([doneEvent()])
        },
        sessionId: Effect.succeed(session.sessionId),
        session: Effect.succeed(session),
        setConfigOption: () => Effect.void
      })
    )

    await Effect.runPromise(
      runAcpPrompt({
        prompt: "hello",
        system: "be brief",
        jsonSchema: { type: "object" }
      }).pipe(Effect.provide(layer))
    )

    expect(seen).toContain("be brief")
    expect(seen).toContain("hello")
    expect(seen).toContain("Respond with JSON only")
  })
})

const claudeLikeOptions = (model: string, effort: string): AcpSessionInfo["configOptions"] => [
  {
    id: "model",
    category: "model",
    currentValue: model,
    options: [{ value: "default" }, { value: "sonnet" }, { value: "haiku" }]
  },
  {
    id: "effort",
    category: "thought_level",
    currentValue: effort,
    // Haiku has no effort levels; Sonnet has low..high.
    options: model === "haiku"
      ? []
      : [{ value: "default" }, { value: "low" }, { value: "high" }]
  }
]

/** A fake agent whose effort list depends on the selected model, like Claude Code. */
const switchingAgent = (calls: Array<readonly [string, string]>, failOn?: string) => {
  let model = "default"
  let effort = "default"
  const info = (): AcpSessionInfo => ({ ...session, configOptions: claudeLikeOptions(model, effort) })
  return Layer.succeed(AcpClient)(
    AcpClient.of({
      prompt: () => Effect.succeed("answer"),
      promptEvents: () => Stream.fromIterable([doneEvent()]),
      sessionId: Effect.succeed(session.sessionId),
      session: Effect.sync(info),
      setConfigOption: (id, value) =>
        value === failOn
          ? Effect.fail(new AcpError({ message: "Internal error" }))
          : Effect.sync(() => {
              calls.push([id, value])
              if (id === "model") model = value
              if (id === "effort") effort = value
            })
    })
  )
}

describe("model and effort selection", () => {
  test("selects the model first, then the effort of that model", async () => {
    const calls: Array<readonly [string, string]> = []
    const artifacts = await Effect.runPromise(
      runAcpPrompt({ prompt: "hi", model: "sonnet", effort: "high" }).pipe(
        Effect.provide(switchingAgent(calls))
      )
    )

    expect(calls).toEqual([["model", "sonnet"], ["effort", "high"]])
    expect(artifacts.model).toBe("sonnet")
    expect(artifacts.effort).toBe("high")
  })

  test("an effort the model does not offer is a clear error", async () => {
    const calls: Array<readonly [string, string]> = []
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hi", model: "sonnet", effort: "max" }).pipe(
        Effect.provide(switchingAgent(calls))
      )
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain('effort "max" is not offered')
    expect(exit.message).toContain("low, high")
  })

  test("a model without effort levels rejects an effort request", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hi", model: "haiku", effort: "low" }).pipe(
        Effect.provide(switchingAgent([]))
      )
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain('cannot select effort "low"')
  })

  test("an unknown model lists what the agent offers", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hi", model: "gpt-9" }).pipe(
        Effect.provide(switchingAgent([]))
      )
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain('model "gpt-9" is not offered')
    expect(exit.message).toContain("default, sonnet, haiku")
  })

  test("a refused selection reports the agent's reason, with no fallback", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hi", model: "sonnet" }).pipe(
        Effect.provide(switchingAgent([], "sonnet"))
      )
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain('could not select model "sonnet"')
    expect(exit.message).toContain("Internal error")
  })

  test("payloadHarness reads the agent id from a raw payload", () => {
    expect(payloadHarness({ prompt: "x", harness: " claude " })).toBe("claude")
    expect(payloadHarness({ prompt: "x" })).toBeUndefined()
    expect(payloadHarness("x")).toBeUndefined()
  })
})

describe("runInferenceExit", () => {
  test("reports prepared with artifacts on success", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hello" }).pipe(Effect.provide(acpLayer([doneEvent()])))
    )

    expect(exit.tag).toBe("prepared")
    expect(exit.artifacts).toMatchObject({
      text: "answer",
      model: "fake/model",
      durationMs: 42
    })
  })

  test("reports inference_failed when ACP fails", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hello" }).pipe(
        Effect.provide(failingAcpLayer("agent exploded"))
      )
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain("agent exploded")
  })

  test("reports inference_failed for an invalid payload", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ nope: true }).pipe(Effect.provide(AcpClient.layerUnavailable))
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain("invalid inference payload")
  })

  test("reports inference_failed when an unavailable ACP is configured", async () => {
    const exit = await Effect.runPromise(
      runInferenceExit({ prompt: "hello" }).pipe(Effect.provide(AcpClient.layerUnavailable))
    )

    expect(exit.tag).toBe("inference_failed")
    expect(exit.message).toContain("ACP is disabled")
  })
})
