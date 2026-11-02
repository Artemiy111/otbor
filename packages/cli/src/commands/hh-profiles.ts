import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const accountsDir = () => join(homedir(), ".otbor", "hh", "accounts")

export const hhProfilesCommand = Command.make(
  "profiles",
  {},
  Effect.fn(function*() {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(accountsDir()),
      catch: () => new Error("no dir")
    }).pipe(Effect.orElseSucceed(() => [] as string[]))

    if (entries.length === 0) {
      yield* Console.log("Профилей нет. Выполните: otbor hh login --profile <имя>")
      return
    }
    for (const name of entries.sort()) {
      const path = join(accountsDir(), name, "storage-state.json")
      let status = "нет сессии"
      const st = yield* Effect.tryPromise({
        try: () => stat(path),
        catch: () => new Error("missing")
      }).pipe(Effect.orElseSucceed(() => null))
      if (st !== null) status = `сессия ${st.mtime.toISOString()}`
      yield* Console.log(`${name} — ${status}`)
    }
  })
).pipe(Command.withDescription("List saved hh.ru profiles"))