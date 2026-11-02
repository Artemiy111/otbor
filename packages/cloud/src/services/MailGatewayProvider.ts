import type { ApiError } from "@otbor/contract"
import { InvalidInput, StorageError } from "@otbor/contract"
import { ImapGateway, readAccountSecret, type MailGateway } from "@otbor/mail"
import { Context, Effect, Layer } from "effect"

export interface MailGatewayAccount {
  readonly id: string
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly username: string
}

export interface MailGatewayProviderShape {
  /**
   * Opens one connection. The password comes from the local credential store
   * (`OTBOR_MAIL_DIR`), never from Postgres and never from the RPC payload.
   */
  readonly open: (account: MailGatewayAccount) => Effect.Effect<MailGateway, ApiError>
}

export class MailGatewayProvider extends Context.Service<
  MailGatewayProvider,
  MailGatewayProviderShape
>()("otbor/cloud/MailGatewayProvider") {
  static readonly layer = Layer.succeed(MailGatewayProvider, {
    open: (account) =>
      Effect.gen(function*() {
        const secret = yield* Effect.tryPromise({
          try: () => readAccountSecret(account.id),
          catch: (cause) =>
            new StorageError({
              operation: "mail.secret.read",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause instanceof Error ? cause : undefined
            })
        })

        if (secret === null) {
          return yield* new InvalidInput({
            message: `mail account ${account.id} has no stored password; add it again with --password`
          })
        }

        return new ImapGateway({
          host: account.host,
          port: account.port,
          secure: account.secure,
          username: account.username,
          password: secret.password
        })
      })
  })

  /** Test double: one gateway for every account. */
  static readonly fixed = (gateway: MailGateway): Layer.Layer<MailGatewayProvider> =>
    Layer.succeed(MailGatewayProvider, { open: () => Effect.succeed(gateway) })
}
