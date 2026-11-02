import { parsePresetFilter, type PresetId } from "@otbor/contract"
import { Console, Effect, FileSystem, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const list = Command.make(
  "list",
  {
    kind: Flag.Literals("kind", ["explore", "apply"]).pipe(Flag.optional),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ kind, json }) {
    const api = yield* Api
    const presets = yield* api.PresetsList({ kind: Option.getOrUndefined(kind) })

    if (json) {
      yield* Console.log(JSON.stringify(presets, null, 2))
      return
    }
    if (presets.length === 0) {
      yield* Console.log("No presets.")
      return
    }

    yield* Console.log(
      table(
        ["id", "kind", "title", "system"],
        presets.map((preset) => [
          shortId(preset.id),
          preset.kind,
          preset.title,
          preset.system ? "yes" : "no"
        ])
      )
    )
  })
).pipe(Command.withDescription("List explore and apply presets"))

const upsert = Command.make(
  "upsert",
  {
    kind: Flag.Literals("kind", ["explore", "apply"]).pipe(
      Flag.withDescription("Preset kind")
    ),
    title: Flag.String("title").pipe(Flag.withDescription("Preset title")),
    filter: Flag.String("filter").pipe(
      Flag.withDescription("Filter JSON, or @path to read from a file"),
      Flag.withDefault("{}")
    ),
    id: Flag.String("id").pipe(Flag.withDescription("Update an existing preset"), Flag.optional)
  },
  Effect.fn(function*({ kind, title, filter, id }) {
    const fs = yield* FileSystem.FileSystem
    const api = yield* Api

    const text = filter.startsWith("@") ? yield* fs.readFileString(filter.slice(1)) : filter
    const parsed: unknown = JSON.parse(text)

    const preset = yield* api.PresetsUpsert({
      id: Option.getOrUndefined(id),
      kind,
      title,
      filter: parsePresetFilter(parsed)
    })
    yield* Console.log(`${preset.id}  ${preset.kind}  ${preset.title}`)
  })
).pipe(Command.withDescription("Create or update a preset"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Preset id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.PresetsRemove({ id: id as PresetId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Delete a user preset"))

export const presetCommand = Command.make("preset").pipe(
  Command.withSubcommands([list, upsert, remove]),
  Command.withDescription("Search and apply presets")
)
