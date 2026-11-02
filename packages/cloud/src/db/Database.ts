import { sql } from "drizzle-orm"
import { makeWithDefaults, type EffectPgDatabase } from "drizzle-orm/effect-postgres"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { PgLayer } from "./PgLayer.ts"

export type Drizzle = EffectPgDatabase

/** Every failure a Drizzle query can produce on the Effect SQL driver. */
export type DatabaseError = SqlError | EffectDrizzleQueryError

/**
 * A repository function runs inside `Database.asOwner`/`Database.asUser` and
 * reports driver failures as `DatabaseError`. Services translate that into the
 * typed `ApiError` the RPC boundary exposes; nothing below the service leaks a
 * driver error to a caller.
 */
export type RepoEffect<A> = Effect.Effect<A, DatabaseError>

/**
 * Both the database and a transaction expose the same query builder surface.
 * Repositories accept an `Executor` so a service decides once whether it runs
 * as the owner (ingest, queue claim) or as the runtime role (anything a user
 * can trigger).
 */
export type Executor = Pick<Drizzle, "select" | "insert" | "update" | "delete" | "execute">

/** The database name of the role every user-scoped query runs as. */
export const RUNTIME_ROLE = "otbor_runtime"

/**
 * Runs `effect` inside a transaction whose role is `otbor_runtime` and whose
 * `app.user_id` is set. Both are transaction-local: the pool hands the
 * connection to the next request with no user attached, which is what keeps
 * RLS fail-closed.
 */
const withUser = <A, E, R>(
  db: Drizzle,
  userId: string,
  effect: (tx: Executor) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | DatabaseError, R> =>
  db.transaction((tx) =>
    Effect.gen(function*() {
      yield* tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
      yield* tx.execute(sql.raw(`set local role ${RUNTIME_ROLE}`))
      return yield* effect(tx)
    })
  )

/**
 * Owns the Effect SQL Postgres client and the Drizzle database.
 *
 * Query builders are Effect values, so there is no Promise boundary and the
 * layer scope closes the pool.
 */
export class Database extends Context.Service<
  Database,
  {
    readonly db: Drizzle
    /** Explicitly owner-scoped: migrations, ingest, queue claim, scheduler. */
    readonly asOwner: <A, E, R>(
      effect: (tx: Executor) => Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | DatabaseError, R>
    /** User-scoped: every request path and every application write. */
    readonly asUser: <A, E, R>(
      userId: string,
      effect: (tx: Executor) => Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | DatabaseError, R>
  }
>()("otbor/cloud/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function*() {
      const db = yield* makeWithDefaults()
      yield* Effect.logInfo("Connected to Postgres (Drizzle + Effect SQL)")

      return Database.of({
        db,
        asOwner: (effect) => db.transaction(effect),
        asUser: (userId, effect) => withUser(db, userId, effect)
      })
    })
  ).pipe(Layer.provide(PgLayer))
}
