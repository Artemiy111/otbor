import type { ApiError, Health } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import { toStorageError } from "./support.ts"

export const VERSION = "0.1.0"

export class SystemService extends Context.Service<
  SystemService,
  { readonly health: () => Effect.Effect<Health, ApiError> }
>()("otbor/cloud/SystemService") {
  static readonly layer = Layer.effect(
    SystemService,
    Effect.gen(function*() {
      const database = yield* Database

      const health: SystemService["Service"]["health"] = () =>
        database
          .asOwner((tx) => tx.execute(sql`select 1 as ok`))
          .pipe(
            Effect.map(
              (): Health => ({
                status: "ok",
                version: VERSION,
                database: true,
                now: new Date().toISOString()
              })
            ),
            Effect.mapError(toStorageError("system.health")),
            Effect.catchTag("StorageError", (error) =>
              Effect.succeed<Health>({
                status: "degraded",
                version: VERSION,
                database: false,
                now: new Date().toISOString()
              }).pipe(Effect.tap(() => Effect.logWarning(error.message)))
            )
          )

      return SystemService.of({ health })
    })
  )
}
