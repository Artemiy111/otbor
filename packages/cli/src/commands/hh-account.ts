import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { checkProfileSession, formatLastOk, fullName, isReplaceableLabel } from "../hh-session.ts"

export const hhAccountListCommand = Command.make(
  "list",
  {},
  Effect.fn(function*() {
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    for (const a of accounts) {
      const name = a.label || fullName({ firstName: a.firstName ?? null, lastName: a.lastName ?? null })
      const session = a.session ? `${a.session.state} (last ok ${formatLastOk(a.session.lastOkAt)})` : "unknown"
      yield* Console.log(`${a.id}  ${name}  ${a.isDefault ? "(default)  " : ""}profile=${a.sessionProfile ?? "none"}  session=${session}`)
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

export const hhAccountRefreshCommand = Command.make(
  "refresh",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("Account id; all accounts with a session profile when omitted"),
      Flag.withDefault("")
    )
  },
  Effect.fn(function*({ account }) {
    const api = yield* Api
    const all = yield* api.HhAccountsList()
    const targets = all.filter((a) => a.sessionProfile !== null && (account === "" || a.id === account))
    if (targets.length === 0) yield* Console.log("Нет аккаунтов с профилем сессии.")
    for (const acc of targets) {
      const stored = yield* api.HhAccountSessionStateGet({ id: acc.id })
      const check = yield* Effect.promise(() => checkProfileSession(stored.state))
      if (check.state !== "ok") {
        yield* api.HhAccountSessionSet({ id: acc.id, state: check.state, error: check.error })
        yield* Console.log(`${acc.label}: сессия ${check.state}, имя не обновлено`)
        continue
      }
      const name = fullName(check.name)
      const updated = yield* api.HhAccountUpsert({
        id: acc.id,
        // a label the operator customised is never overwritten
        label: isReplaceableLabel(acc.label) && name !== "" ? name : acc.label,
        isDefault: acc.isDefault,
        firstName: check.name.firstName ?? acc.firstName ?? null,
        lastName: check.name.lastName ?? acc.lastName ?? null
      })
      yield* api.HhAccountSessionSet({ id: acc.id, state: "ok" })
      yield* Console.log(`${acc.id}  ${acc.label} -> ${updated.label}`)
    }
  })
).pipe(Command.withDescription("Refresh first/last name (and a default label) from the hh profile"))

export const hhAccountCommand = Command.make("account").pipe(
  Command.withSubcommands([hhAccountListCommand, hhAccountAddCommand, hhAccountRefreshCommand, hhAccountRemoveCommand]),
  Command.withDescription("Manage hh.ru accounts")
)
