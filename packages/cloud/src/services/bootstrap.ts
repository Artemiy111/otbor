import { Config, Effect } from "effect"
import { Database } from "../db/Database.ts"
import { users } from "../db/tables.ts"

/**
 * Local single-user mode needs exactly one `user` row for foreign keys to
 * point at. Hosted auth creates it itself; this is a no-op there.
 */
export const ensureBootstrapUser = Effect.gen(function*() {
  const database = yield* Database
  const userId = yield* Config.String("BOOTSTRAP_USER_ID").pipe(
    Config.withDefault("local-user")
  )
  const email = yield* Config.String("BOOTSTRAP_USER_EMAIL").pipe(
    Config.withDefault("local@otbor.local")
  )

  yield* database.asOwner((tx) =>
    tx
      .insert(users)
      .values({ id: userId, name: "Local user", email })
      .onConflictDoNothing({ target: users.id })
  )
})
