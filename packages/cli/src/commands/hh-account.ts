import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

export const hhAccountListCommand = Command.make(
  "list",
  {},
  Effect.fn(function*() {
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    for (const a of accounts) {
      yield* Console.log(`${a.id}  ${a.label}  ${a.isDefault ? "(default)" : ""}  profile=${a.sessionProfile ?? "none"}  ${a.firstName ?? ""} ${a.lastName ?? ""}`.trim())
    }
    if (accounts.length === 0) yield* Console.log("Аккаунтов нет.")
  })
).pipe(Command.withDescription("List hh.ru accounts"))

export const hhAccountAddCommand = Command.make(
  "add",
  {
    label: Flag.String("label").pipe(Flag.withDescription("Account label")),
    profile: Flag.String("profile").pipe(Flag.withDescription("Session profile name"), Flag.withDefault("default")),
    firstName: Flag.String("first-name").pipe(Flag.withDescription("First name"), Flag.withDefault("")),
    lastName: Flag.String("last-name").pipe(Flag.withDescription("Last name"), Flag.withDefault("")),
    default: Flag.Boolean("default").pipe(Flag.withDescription("Set as default"), Flag.withDefault(false))
  },
  Effect.fn(function*({ label, profile, firstName, lastName, default: isDefault }) {
    const api = yield* Api
    const account = yield* api.HhAccountUpsert({
      label,
      sessionProfile: profile,
      firstName: firstName === "" ? undefined : firstName,
      lastName: lastName === "" ? undefined : lastName,
      isDefault
    })
    yield* Console.log(`Создан аккаунт: ${account.id} (${account.label}) profile=${account.sessionProfile}`)
  })
).pipe(Command.withDescription("Add hh.ru account"))

export const hhAccountRemoveCommand = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Account id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const res = yield* api.HhAccountRemove({ id: id as any })
    yield* Console.log(res.deleted ? "Удалено." : "Не найдено.")
  })
).pipe(Command.withDescription("Remove hh.ru account"))

export const hhAccountCommand = Command.make("account").pipe(
  Command.withSubcommands([hhAccountListCommand, hhAccountAddCommand, hhAccountRemoveCommand]),
  Command.withDescription("Manage hh.ru accounts")
)
