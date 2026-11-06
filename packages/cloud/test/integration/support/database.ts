import { PgClient } from "@effect/sql-pg"
import { Effect, Logger, Redacted } from "effect"
import { randomUUID } from "node:crypto"
import { runMigrations } from "../../../src/db/migrate.ts"

/**
 * The integration suite is opt-in. `OTBOR_TEST_DATABASE_URL` is a connection
 * string to the *server*: its database name is ignored, and every run creates
 * its own `otbor_it_<pid>_<random>` database. Nothing is ever written to the
 * database named in the URL, so pointing it at `otbor` cannot damage the demo
 * corpus. `bun run test:integration` supplies the local Docker default.
 */
export const serverUrl = process.env.OTBOR_TEST_DATABASE_URL ?? null

export const integrationEnabled = serverUrl !== null && serverUrl !== ""

const databaseName = `otbor_it_${process.pid}_${randomUUID().slice(0, 8)}`

const urlFor = (base: string, database: string): string => {
  const parsed = new URL(base)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

/** Maintenance connection: always the `postgres` database, never the demo one. */
const maintenanceUrl = (base: string): string => urlFor(base, "postgres")

export const testDatabaseUrl = (base: string): string => urlFor(base, databaseName)

const quoteIdentifier = (name: string): string => {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`unsafe database identifier: ${name}`)
  }
  return `"${name}"`
}

const adminLayer = (base: string) =>
  PgClient.layer({ url: Redacted.make(maintenanceUrl(base)) })

export const quiet = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([])))

const withAdmin = <A, E>(base: string, effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(quiet(effect.pipe(Effect.provide(adminLayer(base)))))

/** Creates the run's database. A stale leftover from a crashed run is dropped. */
export const createTestDatabase = (base: string): Promise<void> =>
  withAdmin(
    base,
    Effect.gen(function*() {
      const sqlClient = yield* PgClient.PgClient
      const name = quoteIdentifier(databaseName)
      yield* sqlClient.unsafe(`drop database if exists ${name}`)
      yield* sqlClient.unsafe(`create database ${name}`)
    })
  )

/** Applies the hand-written migrations through the real migrator. */
export const migrateTestDatabase = (base: string): Promise<void> =>
  Effect.runPromise(
    quiet(
      runMigrations().pipe(
        Effect.provide(PgClient.layer({ url: Redacted.make(testDatabaseUrl(base)) }))
      )
    )
  ).then(() => undefined)

/** Terminates leftovers and drops the run's database. */
export const dropTestDatabase = (base: string): Promise<void> =>
  withAdmin(
    base,
    Effect.gen(function*() {
      const sqlClient = yield* PgClient.PgClient
      // A crashed run can leave a pool open; terminate it before dropping.
      yield* sqlClient.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where datname = '${databaseName}' and pid <> pg_backend_pid()`
      )
      yield* sqlClient.unsafe(`drop database if exists ${quoteIdentifier(databaseName)}`)
    })
  )
