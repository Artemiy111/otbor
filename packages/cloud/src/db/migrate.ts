import { Effect } from "effect"
import { make } from "effect/sql/Migrator"
import { SqlClient } from "effect/sql/SqlClient"
import { resolve } from "node:path"
import { PgLayer } from "./PgLayer.ts"
import { loader, type MigrationFile } from "./migrator.ts"

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations")

/**
 * Migrations live as SQL files next to the package, not as embedded strings,
 * so they can be reviewed and run by hand. The numeric prefix orders them.
 */
export const migrationFiles = (
  directory: string = MIGRATIONS_DIR
): ReadonlyArray<MigrationFile> => {
  const glob = new Bun.Glob("*.sql")
  const files: Array<MigrationFile> = []

  for (const absolute of glob.scanSync({ cwd: directory, absolute: true })) {
    const name = absolute.slice(absolute.lastIndexOf("/") + 1)
    const match = /^(\d+)_(.+)\.sql$/.exec(name)
    if (match === null) {
      throw new Error(`Migration file must be named <id>_<name>.sql: ${name}`)
    }
    files.push({ id: Number(match[1]), name: match[2]!, path: absolute })
  }

  return files.sort((left, right) => left.id - right.id)
}

export const runMigrations = (directory?: string) =>
  Effect.gen(function*() {
    return yield* make({})({ loader: loader(migrationFiles(directory)) })
  })

/**
 * Drops and rebuilds the schema. Destructive by design: the command is called
 * `db reset`, and it is the only supported way to get a clean local database.
 */
export const resetSchema = Effect.gen(function*() {
  const sql = yield* SqlClient
  yield* sql.unsafe("drop schema public cascade")
  yield* sql.unsafe("create schema public")
  yield* sql.unsafe("grant usage, create on schema public to public")
})

export const migrateProgram = (options: { readonly reset?: boolean } = {}) =>
  Effect.gen(function*() {
    if (options.reset === true) {
      yield* resetSchema
    }
    const applied = yield* runMigrations()
    yield* Effect.logInfo(
      applied.length === 0
        ? "Database is up to date"
        : `Applied ${applied.length} migration(s): ${applied.map(([id, name]) => `${id}_${name}`).join(", ")}`
    )
    return applied
  }).pipe(Effect.provide(PgLayer))
