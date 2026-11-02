import type { TelegramAccountId } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const list = Command.make(
  "list",
  {
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const accounts = yield* api.TelegramAccountsList()

    if (json) {
      yield* Console.log(JSON.stringify(accounts, null, 2))
      return
    }
    if (accounts.length === 0) {
      yield* Console.log("No Telegram accounts.")
      return
    }

    yield* Console.log(
      table(
        ["id", "label", "user", "phone", "status", "last sync", "error"],
        accounts.map((account) => [
          shortId(account.id),
          account.label,
          account.username === null ? (account.tgUserId ?? "-") : `@${account.username}`,
          account.phoneMasked ?? "-",
          account.status,
          account.lastSyncAt === null
            ? "-"
            : account.lastSyncAt.slice(0, 16).replace("T", " "),
          account.lastError ?? "-"
        ])
      )
    )
  })
).pipe(Command.withDescription("List Telegram accounts"))

const add = Command.make(
  "add",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Update an existing account"),
      Flag.optional
    ),
    label: Flag.String("label").pipe(Flag.withDescription("Operator label, e.g. hr")),
    apiId: Flag.Int("api-id").pipe(
      Flag.withDescription("Application id from my.telegram.org")
    ),
    apiHash: Flag.String("api-hash").pipe(
      Flag.withDescription("Application hash; stored outside the repository")
    ),
    phone: Flag.String("phone").pipe(
      Flag.withDescription("Phone in international format; only the mask is stored"),
      Flag.optional
    )
  },
  Effect.fn(function*({ id, label, apiId, apiHash, phone }) {
    const api = yield* Api
    const account = yield* api.TelegramAccountUpsert({
      id: Option.getOrUndefined(id) as TelegramAccountId | undefined,
      label,
      apiId,
      apiHash,
      phone: Option.getOrUndefined(phone)
    })
    yield* Console.log(`${account.id}  ${account.label}  ${account.status}`)
  })
).pipe(Command.withDescription("Create or update a Telegram account"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Telegram account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.TelegramAccountRemove({ id: id as TelegramAccountId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Delete a Telegram account and its local session"))

const loginQr = Command.make(
  "login-qr",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Telegram account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.TelegramLoginQr({ id: id as TelegramAccountId })
    yield* Console.log(result.qrUrl)
    yield* Console.log(`expires ${result.expiresAt}`)
    yield* Console.log("Scan the QR with Telegram, then check: otbor telegram account status --id …")
  })
).pipe(Command.withDescription("Start a QR login; the session is stored when confirmed"))

const status = Command.make(
  "status",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Telegram account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.TelegramLoginStatus({ id: id as TelegramAccountId })
    yield* Console.log(result.status)
    if (result.error !== null && result.error !== undefined) {
      yield* Console.log(`error: ${result.error}`)
    }
  })
).pipe(Command.withDescription("Poll the QR login status"))

const sync = Command.make(
  "sync",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Telegram account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.TelegramSyncNow({ id: id as TelegramAccountId })
    yield* Console.log(
      `dialogs ${result.processed} · messages ${result.inserted} · conversations ${result.updated}` +
        ` · skipped ${result.skipped} · contacts ${result.contacts} · linked ${result.linked}`
    )
    for (const error of result.errors) {
      yield* Console.log(`  error: ${error}`)
    }
  })
).pipe(Command.withDescription("Sync private dialogs once, synchronously"))

const account = Command.make("account").pipe(
  Command.withSubcommands([list, add, remove, loginQr, status, sync]),
  Command.withDescription("Telegram account management")
)

export const telegramCommand = Command.make("telegram").pipe(
  Command.withSubcommands([account]),
  Command.withDescription("Telegram sources: accounts, QR login and sync")
)
