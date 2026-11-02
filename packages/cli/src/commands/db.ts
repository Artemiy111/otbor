import { migrateProgram } from "@otbor/cloud"
import { Console, Effect, Logger } from "effect"
import { Command, Flag } from "effect/cli"
import { seedProgram } from "../db.ts"

const migrate = Command.make(
  "migrate",
  {
    reset: Flag.Boolean("reset").pipe(
      Flag.withDescription("Drop the schema and rebuild it from scratch"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ reset }) {
    const applied = yield* migrateProgram({ reset }).pipe(Effect.provide(Logger.layer([])))
    yield* Console.log(
      applied.length === 0
        ? "Database is up to date"
        : `Applied ${applied.length} migration(s): ${applied
            .map(([id, name]) => `${id}_${name}`)
            .join(", ")}`
    )
  })
).pipe(Command.withDescription("Apply SQL migrations, optionally after a reset"))

const seed = Command.make(
  "seed",
  {
    label: Flag.String("account-label").pipe(
      Flag.withDescription("Label for the local hh account created on first seed"),
      Flag.withDefault("local")
    )
  },
  Effect.fn(function*({ label }) {
    yield* seedProgram({ label })
  })
).pipe(
  Command.withDescription("Create the local user, import the DevOps lexicon and add an hh account")
)

export const dbCommand = Command.make("db").pipe(
  Command.withSubcommands([migrate, seed]),
  Command.withDescription("Local database operations (direct Postgres, not RPC)")
)
