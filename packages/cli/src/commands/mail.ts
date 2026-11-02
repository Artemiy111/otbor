import type { MailAccountId } from "@otbor/contract"
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
    const accounts = yield* api.MailAccountsList()

    if (json) {
      yield* Console.log(JSON.stringify(accounts, null, 2))
      return
    }
    if (accounts.length === 0) {
      yield* Console.log("No mail accounts.")
      return
    }

    yield* Console.log(
      table(
        ["id", "label", "address", "status", "last sync", "error"],
        accounts.map((account) => [
          shortId(account.id),
          account.label,
          account.address,
          account.status,
          account.lastSyncAt === null
            ? "-"
            : account.lastSyncAt.slice(0, 16).replace("T", " "),
          account.lastError ?? "-"
        ])
      )
    )
  })
).pipe(Command.withDescription("List mail accounts"))

const add = Command.make(
  "add",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Update an existing account"),
      Flag.optional
    ),
    label: Flag.String("label").pipe(Flag.withDescription("Operator label, e.g. work")),
    address: Flag.String("address").pipe(Flag.withDescription("Mailbox address")),
    host: Flag.String("host").pipe(Flag.withDescription("IMAP host")),
    port: Flag.Int("port").pipe(
      Flag.withDescription("IMAP port"),
      Flag.withDefault(993)
    ),
    username: Flag.String("username").pipe(Flag.withDescription("IMAP username")),
    password: Flag.String("password").pipe(
      Flag.withDescription("App password; stored outside the repository"),
      Flag.optional
    ),
    includeSent: Flag.Boolean("include-sent").pipe(Flag.withDefault(true)),
    backfillDays: Flag.Int("backfill-days").pipe(Flag.withDefault(90)),
    enabled: Flag.Boolean("enabled").pipe(Flag.withDefault(true))
  },
  Effect.fn(function*({ id, label, address, host, port, username, password, includeSent, backfillDays, enabled }) {
    const api = yield* Api
    const account = yield* api.MailAccountUpsert({
      id: Option.getOrUndefined(id) as MailAccountId | undefined,
      label,
      address,
      host,
      port,
      username,
      password: Option.getOrUndefined(password),
      includeSent,
      backfillDays,
      enabled
    })
    yield* Console.log(`${account.id}  ${account.address}  ${account.status}`)
  })
).pipe(Command.withDescription("Create or update a mail account"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Mail account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.MailAccountRemove({ id: id as MailAccountId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Delete a mail account and its stored password"))

const test = Command.make(
  "test",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Mail account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.MailAccountTest({ id: id as MailAccountId })
    yield* Console.log(
      `${result.ok ? "ok" : "failed"}  ${result.address}  folders=${result.folders}  messages=${result.messages ?? "-"}`
    )
  })
).pipe(Command.withDescription("Verify IMAP credentials and folder access"))

const account = Command.make("account").pipe(
  Command.withSubcommands([list, add, remove, test]),
  Command.withDescription("Mail account management")
)

const sync = Command.make(
  "sync",
  {
    account: Flag.String("account").pipe(Flag.withDescription("Mail account id"))
  },
  Effect.fn(function*({ account: accountId }) {
    const api = yield* Api
    const result = yield* api.MailSyncNow({ id: accountId as MailAccountId })
    yield* Console.log(
      `processed ${result.processed} · inserted ${result.inserted} · updated ${result.updated}` +
        ` · skipped ${result.skipped} · contacts ${result.contacts} · linked ${result.linked}`
    )
    for (const error of result.errors) {
      yield* Console.log(`  error: ${error}`)
    }
  })
).pipe(Command.withDescription("Sync INBOX (and Sent) once, synchronously"))

export const mailCommand = Command.make("mail").pipe(
  Command.withSubcommands([account, sync]),
  Command.withDescription("Mail sources: accounts and IMAP sync")
)
