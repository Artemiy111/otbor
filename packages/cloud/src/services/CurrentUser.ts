import type { UserId } from "@otbor/contract"
import { Config, Context, Effect, Layer } from "effect"

/**
 * The user a request belongs to.
 *
 * Local single-user mode sets `BOOTSTRAP_USER_ID`, and every request is scoped
 * to it. Authentication replaces this layer with a per-request one; nothing
 * below reads an id from the payload.
 */
export class CurrentUser extends Context.Service<CurrentUser, { readonly userId: UserId }>()(
  "otbor/cloud/CurrentUser"
) {
  static readonly layer = Layer.unwrap(
    Effect.gen(function*() {
      const userId = yield* Config.String("BOOTSTRAP_USER_ID").pipe(
        Config.withDefault("local-user")
      )
      return Layer.succeed(CurrentUser, { userId: userId as UserId })
    })
  )
}
