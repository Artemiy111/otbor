import { hhProfileDir } from "@otbor/harness"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { chromium } from "playwright"
import { existsSync } from "node:fs"
import { Api } from "../client.ts"

/**
 * Разовый перенос: cookies из старых профилей Chrome (`~/.otbor/hh/accounts/<имя>`)
 * в облако. Профиль не должен быть открыт другим Chrome. После переноса папки
 * профилей можно удалить: харнесс их больше не читает.
 */
export const hhImportCommand = Command.make(
  "import-profiles",
  {},
  Effect.fn(function*() {
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    const targets = accounts.filter((a) => a.sessionProfile !== null)
    if (targets.length === 0) yield* Console.log("Нет аккаунтов с профилем сессии.")
    for (const account of targets) {
      const dir = hhProfileDir(account.sessionProfile)
      if (!existsSync(dir)) {
        yield* Console.log(`${account.label}: профиля ${dir} нет, пропущен`)
        continue
      }
      const state = yield* Effect.tryPromise({
        try: async () => {
          const context = await chromium.launchPersistentContext(dir, {
            headless: true,
            executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ignoreDefaultArgs: ["--no-sandbox"]
          })
          try {
            return await context.storageState()
          } finally {
            await context.close()
          }
        },
        catch: (error) => new Error(`${account.label}: не удалось открыть профиль ${dir}: ${error}`)
      })
      const saved = yield* api.HhAccountSessionStatePut({ id: account.id, state: JSON.stringify(state) })
      yield* Console.log(`${account.label}: cookies перенесены в облако (версия ${saved.version}, ${state.cookies.length} шт.)`)
    }
  })
).pipe(Command.withDescription("Copy cookies from old local Chrome profiles into the cloud (one-off)"))
