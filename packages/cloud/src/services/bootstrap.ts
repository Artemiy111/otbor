import {
  DEVOPS_APPLY_FILTER,
  DEVOPS_PRESET_TITLE,
  FRONTEND_APPLY_FILTER,
  FRONTEND_PRESET_TITLE
} from "@otbor/domain"
import { Config, Effect } from "effect"
import { Database } from "../db/Database.ts"
import * as PresetRepository from "../repositories/PresetRepository.ts"
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

/**
 * System presets: templates every user can copy into an apply filter. The
 * "DevOps" one holds the same filter as the built-in default. Idempotent; the
 * stored filter follows the one in code.
 */
export const ensureSystemPresets = Effect.gen(function*() {
  const database = yield* Database
  yield* database.asOwner((tx) =>
    PresetRepository.ensureSystem(tx, {
      kind: "apply",
      title: DEVOPS_PRESET_TITLE,
      filter: DEVOPS_APPLY_FILTER
    })
  )
  yield* database.asOwner((tx) =>
    PresetRepository.ensureSystem(tx, {
      kind: "apply",
      title: FRONTEND_PRESET_TITLE,
      filter: FRONTEND_APPLY_FILTER
    })
  )
})
