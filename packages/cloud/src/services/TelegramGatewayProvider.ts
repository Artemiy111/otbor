import type { ApiError } from "@otbor/contract"
import { InvalidInput, StorageError } from "@otbor/contract"
import {
  readAccountConfig,
  readAppConfig,
  readSession,
  type TelegramGateway
} from "@otbor/telegram"
import { Context, Effect, Layer } from "effect"

export interface TelegramGatewayAccount {
  readonly id: string
}

export interface TelegramGatewayProviderShape {
  /**
   * Opens one MTProto connection. The app hash and the session live in
   * `OTBOR_TELEGRAM_DIR`, never in Postgres. `fresh` ignores the stored
   * session so a QR login can start from a clean client.
   */
  readonly open: (
    account: TelegramGatewayAccount,
    options?: { readonly fresh?: boolean }
  ) => Effect.Effect<TelegramGateway, ApiError>
}

const storageError = (operation: string, cause: unknown): StorageError =>
  new StorageError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause: cause instanceof Error ? cause : undefined
  })

export class TelegramGatewayProvider extends Context.Service<
  TelegramGatewayProvider,
  TelegramGatewayProviderShape
>()("otbor/cloud/TelegramGatewayProvider") {
  static readonly layer = Layer.succeed(TelegramGatewayProvider, {
    open: (account, options = {}) =>
      Effect.gen(function*() {
        const app = yield* Effect.tryPromise({
          try: () => readAppConfig(),
          catch: (cause) => storageError("telegram.app.read", cause)
        })
        if (app === null) {
          return yield* new InvalidInput({
            message:
              "Telegram application credentials are missing; add an account with --api-id and --api-hash first"
          })
        }

        const session = options.fresh === true
          ? null
          : yield* Effect.tryPromise({
              try: () => readSession(account.id),
              catch: (cause) => storageError("telegram.session.read", cause)
            })
        const config = yield* Effect.tryPromise({
          try: () => readAccountConfig(account.id),
          catch: (cause) => storageError("telegram.account.read", cause)
        })

        // teleproto is only loaded when a real connection is opened, so the
        // CLI and the tests never pay for the MTProto runtime.
        const { TeleprotoGateway } = yield* Effect.tryPromise({
          try: () => import("@otbor/telegram/gateway"),
          catch: (cause) => storageError("telegram.transport", cause)
        })

        return new TeleprotoGateway({
          apiId: app.apiId,
          apiHash: app.apiHash,
          session: session ?? "",
          proxy: config?.proxy ?? null
        })
      })
  })

  /** Test double: one gateway for every account, no MTProto and no disk. */
  static readonly fixed = (gateway: TelegramGateway): Layer.Layer<TelegramGatewayProvider> =>
    Layer.succeed(TelegramGatewayProvider, { open: () => Effect.succeed(gateway) })
}
