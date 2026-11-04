import { AcpClient, AcpError, type AcpSessionInfo } from "@otbor/acp"
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { probeClient, toAgentModel } from "../src/catalog.ts"

/** Effort levels depend on the selected model, like Claude Code and OpenCode. */
const EFFORTS: Record<string, ReadonlyArray<string>> = {
  default: ["default", "low", "medium", "high"],
  sonnet: ["default", "low", "high"],
  haiku: [],
  broken: ["default", "low"]
}

const fakeClient = (initial = "default") => {
  let model = initial
  let effort = "default"
  const info = (): AcpSessionInfo => ({
    sessionId: "s",
    protocolVersion: 1,
    agent: { name: "fake" },
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: model,
        options: Object.keys(EFFORTS).map((value) => ({ value, name: `Name ${value}` }))
      },
      ...(EFFORTS[model]!.length === 0
        ? []
        : [{
            id: "effort",
            category: "thought_level",
            currentValue: effort,
            options: EFFORTS[model]!.map((value) => ({ value }))
          }])
    ]
  })
  return AcpClient.of({
    prompt: () => Effect.succeed(""),
    promptEvents: () => Stream.empty,
    sessionId: Effect.succeed("s"),
    session: Effect.sync(info),
    setConfigOption: (id, value) =>
      id === "model" && value === "broken"
        ? Effect.fail(new AcpError({ message: "Internal error" }))
        : Effect.sync(() => {
            if (id === "model") model = value
            if (id === "effort") effort = value
          })
  })
}

describe("probeClient", () => {
  test("maps models to their own effort levels and skips unselectable ones", async () => {
    const harness = await Effect.runPromise(
      probeClient(fakeClient(), { id: "claude", name: "Claude Code", variant: "Claude subscription" })
    )

    expect(harness.available).toBe(true)
    expect(harness.error).toBeNull()
    expect(harness.defaultModel).toBe("default")
    expect(harness.models.map((model) => model.id)).toEqual(["default", "sonnet", "haiku"])
    expect(harness.models.find((model) => model.id === "sonnet")).toEqual({
      id: "sonnet",
      label: "Name sonnet",
      efforts: ["low", "high"],
      defaultEffort: null,
      variant: "Claude subscription"
    })
    expect(harness.models.find((model) => model.id === "haiku")?.efforts).toEqual([])
  })

  test("an agent without a model option is reported unavailable, not thrown", async () => {
    const client = AcpClient.of({
      ...fakeClient(),
      session: Effect.succeed({
        sessionId: "s",
        protocolVersion: 1,
        agent: {},
        configOptions: []
      })
    })
    const harness = await Effect.runPromise(probeClient(client, { id: "x", name: "X" }))

    expect(harness.available).toBe(false)
    expect(harness.error).toContain("no model option")
    expect(harness.models).toEqual([])
  })

  test("a failing session becomes available:false with the error text", async () => {
    const client = AcpClient.of({
      ...fakeClient(),
      session: Effect.fail(new AcpError({ message: "not logged in" }))
    })
    const harness = await Effect.runPromise(probeClient(client, { id: "x", name: "X" }))

    expect(harness).toMatchObject({ available: false, error: "not logged in", models: [] })
  })
})

describe("toAgentModel", () => {
  test("keeps a non-default current effort as defaultEffort", () => {
    const model = toAgentModel(
      { value: "m", name: "M" },
      { id: "effort", currentValue: "medium", options: [{ value: "none" }, { value: "medium" }] },
      undefined
    )
    expect(model).toEqual({
      id: "m",
      label: "M",
      efforts: ["none", "medium"],
      defaultEffort: "medium",
      variant: null
    })
  })
})
