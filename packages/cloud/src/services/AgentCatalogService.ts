import { HarnessRejected, type AgentCatalog, type AgentHarness, type ApiError } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { hashHarnessToken } from "../auth/harnessToken.ts"
import { Database } from "../db/Database.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface AgentCatalogServiceShape {
  /** Harness side: authenticated by the device token. */
  readonly report: (input: {
    readonly harnessId: string
    readonly token: string
    readonly harnesses: ReadonlyArray<AgentHarness>
  }) => Effect.Effect<{ readonly ok: boolean }, ApiError>
  /** Web side: what the operator can pick from. */
  readonly get: () => Effect.Effect<AgentCatalog, ApiError>
}

/**
 * The agents, models and efforts a harness can run, as the harness probed them.
 * The cloud stores the report and never starts an agent itself.
 */
export class AgentCatalogService extends Context.Service<AgentCatalogService, AgentCatalogServiceShape>()(
  "otbor/cloud/AgentCatalogService"
) {
  static readonly layer = Layer.effect(
    AgentCatalogService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const report: AgentCatalogServiceShape["report"] = (input) =>
        Effect.gen(function*() {
          const accepted = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (
                  !(yield* HarnessRepository.authenticate(tx, input.harnessId, hashHarnessToken(input.token)))
                ) {
                  return false
                }
                yield* HarnessRepository.saveCatalog(tx, input.harnessId, input.harnesses)
                return true
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.reportCatalog")))
          if (!accepted) {
            return yield* new HarnessRejected({ message: "invalid harness id or token" })
          }
          return { ok: true }
        })

      const get: AgentCatalogServiceShape["get"] = () =>
        database
          .asUser(currentUser.userId, (tx) => HarnessRepository.latestCatalog(tx, currentUser.userId))
          .pipe(Effect.mapError(toStorageError("harness.catalog")))

      return AgentCatalogService.of({ report, get })
    })
  )
}
