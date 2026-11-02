import type { GateVerdict } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

const describe = (result: {
  readonly verdict: GateVerdict
  readonly roleFamily: string | null
  readonly strong: ReadonlyArray<string>
  readonly weak: ReadonlyArray<string>
  readonly rejectedBy?: string | null | undefined
}): Array<string> => [
  `verdict:    ${result.verdict}`,
  `role:       ${result.roleFamily ?? "-"}`,
  `strong:     ${result.strong.join(", ") || "-"}`,
  `weak:       ${result.weak.join(", ") || "-"}`,
  `rejectedBy: ${result.rejectedBy ?? "-"}`
]

const preview = Command.make(
  "preview",
  {
    title: Argument.String("title").pipe(Argument.withDescription("Vacancy title to classify"))
  },
  Effect.fn(function*({ title }) {
    const api = yield* Api
    const result = yield* api.TitlesPreview({ title })
    yield* Console.log(describe(result).join("\n"))
  })
).pipe(Command.withDescription("Run the deterministic title gate"))

const setVerdict = (verdict: GateVerdict) => {
  const command = Command.make(
    verdict,
    {
      title: Argument.String("title").pipe(Argument.withDescription("Vacancy title")),
      roleFamily: Flag.String("role-family").pipe(
        Flag.withDescription("Override the inferred role family"),
        Flag.optional
      )
    },
    Effect.fn(function*({ title, roleFamily }) {
      const api = yield* Api
      const record = yield* api.TitlesSetUserVerdict({
        title,
        verdict,
        roleFamily: Option.getOrUndefined(roleFamily)
      })
      yield* Console.log(`${record.normalizedTitle}: ${record.verdict} (${record.source})`)
    })
  )
  return command.pipe(Command.withDescription(`Record a user verdict: ${verdict}`))
}

export const gateCommand = Command.make("gate").pipe(
  Command.withSubcommands([
    preview,
    setVerdict("match"),
    setVerdict("unknown"),
    setVerdict("reject")
  ]),
  Command.withDescription("Title gate: preview, or record a user verdict")
)
