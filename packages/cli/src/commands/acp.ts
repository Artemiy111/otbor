import type { AcpConfigOption } from "@otbor/acp"
import { AcpClient } from "@otbor/acp"
import { Console, Effect, Logger, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { table } from "../format.ts"

/**
 * The agent logs its session banner at info level. Keep stdout for the answer
 * (and for `--json`), and send diagnostics to stderr.
 */
const withAcp = <A, E>(self: Effect.Effect<A, E, AcpClient>) =>
  self.pipe(Effect.provide(AcpClient.layer), Effect.provideService(Logger.LogToStderr, true))

/**
 * ACP agents take a single prompt text. `--system` is therefore prepended to
 * that text, separated by a blank line, instead of being sent as a separate
 * protocol message.
 */
const withSystem = (system: string | undefined, text: string): string => {
  const instructions = system?.trim() ?? ""
  return instructions === "" ? text : `${instructions}\n\n${text}`
}

const valueOf = (options: ReadonlyArray<AcpConfigOption>, id: string): string =>
  options.find((option) => option.id === id)?.currentValue ?? "-"

const optionRow = (option: AcpConfigOption): ReadonlyArray<string> => [
  option.id,
  option.category ?? "-",
  option.currentValue ?? "-",
  option.options?.map((value) => value.value).join(", ") ?? "-"
]

const session = Command.make(
  "session",
  {},
  Effect.fn(function*() {
    const client = yield* AcpClient
    const info = yield* client.session

    yield* Console.log(
      `agent:    ${info.agent.name ?? "unknown"} ${info.agent.version ?? ""}`.trimEnd()
    )
    yield* Console.log(`session:  ${info.sessionId}`)
    yield* Console.log(`protocol: ${info.protocolVersion}`)
    yield* Console.log(`model:    ${valueOf(info.configOptions, "model")}`)
    yield* Console.log(`effort:   ${valueOf(info.configOptions, "effort")}`)
    yield* Console.log(`mode:     ${valueOf(info.configOptions, "mode")}`)

    if (info.configOptions.length === 0) {
      return
    }
    yield* Console.log("")
    yield* Console.log(
      table(
        ["option", "category", "current", "values"],
        info.configOptions.map(optionRow)
      )
    )
  }, withAcp)
).pipe(Command.withDescription("Start an ACP agent and show the session options"))

const prompt = Command.make(
  "prompt",
  {
    text: Argument.String("text").pipe(
      Argument.withDescription("Prompt text sent to the local ACP agent")
    ),
    system: Flag.String("system").pipe(
      Flag.withDescription("System instructions prepended to the prompt"),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the answer and session metadata as JSON"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ text, system, json }) {
    const client = yield* AcpClient
    const info = yield* client.session
    const answer = yield* client.prompt(withSystem(Option.getOrUndefined(system), text))

    if (json) {
      yield* Console.log(
        JSON.stringify(
          {
            agent: info.agent,
            sessionId: info.sessionId,
            model: valueOf(info.configOptions, "model"),
            effort: valueOf(info.configOptions, "effort"),
            mode: valueOf(info.configOptions, "mode"),
            answer
          },
          null,
          2
        )
      )
      return
    }
    yield* Console.log(answer)
  }, withAcp)
).pipe(Command.withDescription("Run one prompt through the local ACP agent"))

export const acpCommand = Command.make("acp").pipe(
  Command.withSubcommands([session, prompt]),
  Command.withDescription("Local ACP agent: session options and direct prompts")
)
