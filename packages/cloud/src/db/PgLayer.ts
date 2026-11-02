import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted } from "effect"

/**
 * The one Postgres connection pool. `DATABASE_URL` is read lazily so the
 * layer can be reused by the server, the CLI and the migrator without each of
 * them parsing the config again.
 */
export const PgLayer = Layer.unwrap(
  Effect.gen(function*() {
    const url = yield* Config.String("DATABASE_URL")
    return PgClient.layer({ url: Redacted.make(url) })
  })
)
