import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Api } from "../client.ts"

export const hhProfilesCommand = Command.make(
  "profiles",
  {},
  Effect.fn(function*() {
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    const named = accounts.filter((a) => a.sessionProfile !== null)
    if (named.length === 0) {
      yield* Console.log("Профилей нет. Выполните: otbor hh login")
      return
    }
    for (const account of named) {
      const stored = yield* api.HhAccountSessionStateGet({ id: account.id })
      const status = stored.state === null ? "нет сессии" : `сессия ${stored.updatedAt ?? ""}`
      yield* Console.log(`${account.sessionProfile} — ${status}`)
    }
  })
).pipe(Command.withDescription("List hh.ru profiles and whether their cookies are stored in the cloud"))
