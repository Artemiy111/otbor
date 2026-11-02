import { Database, ensureBootstrapUser, hhAccount, LexiconRepository } from "@otbor/cloud"
import { DEVOPS_SEED } from "@otbor/domain"
import { eq } from "drizzle-orm"
import { Config, Console, Effect, Logger } from "effect"

/**
 * `db seed` is an operator action, not a product operation, so it is the one
 * place in the CLI that talks to Postgres directly instead of going over RPC.
 */
const userId = Config.String("BOOTSTRAP_USER_ID").pipe(Config.withDefault("local-user"))

const seedAccount = (label: string) =>
  Effect.gen(function*() {
    const database = yield* Database
    const id = yield* userId

    return yield* database.asOwner((tx) =>
      Effect.gen(function*() {
        const existing = yield* tx
          .select()
          .from(hhAccount)
          .where(eq(hhAccount.userId, id))
          .limit(1)
        if (existing.length > 0) {
          return { account: existing[0]!, created: false }
        }

        const inserted = yield* tx
          .insert(hhAccount)
          .values({ userId: id, label, isDefault: true })
          .returning()
        return { account: inserted[0]!, created: true }
      })
    )
  })

export const seedProgram = (options: { readonly label: string }) =>
  Effect.gen(function*() {
    yield* ensureBootstrapUser

    const database = yield* Database
    const count = yield* database.asOwner((tx) => LexiconRepository.seed(tx, DEVOPS_SEED))
    const { account, created } = yield* seedAccount(options.label)

    yield* Console.log(`Lexicon: ${count} term(s)`)
    yield* Console.log(
      `Account: ${account.id} (${created ? "created" : "existing"}, default=${account.isDefault})`
    )
  }).pipe(
    Effect.provide(Database.layer),
    // The CLI prints results, not connection chatter.
    Effect.provide(Logger.layer([]))
  )
