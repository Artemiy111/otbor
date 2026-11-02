
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { chromium } from "playwright"
import { Api } from "../client.ts"

export const blacklistScrapeCommand = Command.make(
  "scrape-hh",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id to import into")
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Login wait timeout, seconds"),
      Flag.withDefault(300)
    )
  },
  Effect.fn(function*({ account, timeout }) {
    const api = yield* Api
    const browser = yield* Effect.tryPromise({
      try: () => chromium.launch({ headless: false, executablePath: "/opt/homebrew/bin/chromium" }),
      catch: (error) => new Error(`browser launch failed: ${error}`)
    })
    const context = yield* Effect.tryPromise({
      try: () => browser.newContext(),
      catch: (error) => new Error(`context failed: ${error}`)
    })
    const page = yield* Effect.tryPromise({
      try: () => context.newPage(),
      catch: (error) => new Error(`page failed: ${error}`)
    })

    yield* Effect.tryPromise({
      try: () => page.goto("https://hh.ru/login"),
      catch: (error) => new Error(`goto failed: ${error}`)
    })

    yield* Console.log("Войдите в аккаунт hh.ru в открывшемся браузере. Ожидание...")

    const deadline = Date.now() + timeout * 1000
    while (Date.now() < deadline) {
      const cookies = yield* Effect.tryPromise({
        try: () => context.cookies("https://hh.ru"),
        catch: (error) => new Error(`cookies failed: ${error}`)
      })
      if (cookies.some((c) => c.name === "hhtoken" || c.name === "hhul")) break
      yield* Effect.sleep("2 seconds")
    }

    const cookies = yield* Effect.tryPromise({
      try: () => context.cookies("https://hh.ru"),
      catch: (error) => new Error(`cookies failed: ${error}`)
    })
    if (!cookies.some((c) => c.name === "hhtoken" || c.name === "hhul")) {
      yield* Effect.tryPromise({ try: () => browser.close(), catch: () => new Error("close failed") })
      return yield* Effect.fail(new Error("login timeout"))
    }

    yield* Effect.tryPromise({
      try: () => page.goto("https://hh.ru/applicant/blacklist/employer", { waitUntil: "networkidle" }),
      catch: (error) => new Error(`blacklist goto failed: ${error}`)
    })

    const entries = yield* Effect.tryPromise({
      try: async () => {
        await page.waitForTimeout(3000)
        const links = await page.locator('a[href*="/employer/"]').all()
        const result: Array<{ targetType: "employer"; externalId: string; name?: string }> = []
        const seen = new Set<string>()
        for (const link of links) {
          const href = (await link.getAttribute("href")) ?? ""
          const match = href.match(/\/employer\/(\d+)/)
          if (!match) continue
          const id = match[1]!
          if (seen.has(id)) continue
          seen.add(id)
          const name = (await link.textContent())?.trim() || undefined
          result.push({ targetType: "employer", externalId: id, name })
        }
        return result
      },
      catch: (error) => new Error(`extract failed: ${error}`)
    })

    yield* Effect.tryPromise({ try: () => browser.close(), catch: () => new Error("close failed") })

    if (entries.length === 0) {
      yield* Console.log("Заблокированных компаний не найдено.")
      return
    }

    const imported = yield* api.BlacklistImportHh({ hhAccountId: account as any, entries })
    yield* Console.log(`Импортировано: ${imported.imported}, обновлено: ${imported.updated}, пропущено: ${imported.skipped}`)
  })
).pipe(Command.withDescription("Scrape hh.ru blacklist via browser and import"))
