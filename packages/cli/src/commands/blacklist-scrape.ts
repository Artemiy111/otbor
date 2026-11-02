import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { chromium } from "playwright"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Api } from "../client.ts"

const profileDir = (name: string) => join(homedir(), ".otbor", "hh", "accounts", name)
const storagePath = (name: string) => join(profileDir(name), "storage-state.json")

export const blacklistScrapeCommand = Command.make(
  "scrape-hh",
  {
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Profile name for this hh.ru account"),
      Flag.withDefault("default")
    ),
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id to import into")
    )
  },
  Effect.fn(function*({ profile, account }) {
    const api = yield* Api
    let resolvedProfile = profile
    if (account !== "") {
      const accounts = yield* api.HhAccountsList()
      const acc = accounts.find((a) => a.id === account)
      if (acc?.sessionProfile) resolvedProfile = acc.sessionProfile
    }
    const path = storagePath(resolvedProfile)

    const state = yield* Effect.tryPromise({
      try: async () => {
        const text = await readFile(path, "utf8")
        return JSON.parse(text)
      },
      catch: () => new Error(`Нет сохранённой сессии hh.ru. Сначала выполните: otbor hh login`)
    })

    const browser = yield* Effect.tryPromise({
      try: () => chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ignoreDefaultArgs: ["--no-sandbox"] }),
      catch: (error) => new Error(`browser launch failed: ${error}`)
    })
    const context = yield* Effect.tryPromise({
      try: () => browser.newContext({ storageState: state }),
      catch: (error) => new Error(`context failed: ${error}`)
    })
    const page = yield* Effect.tryPromise({
      try: () => context.newPage(),
      catch: (error) => new Error(`page failed: ${error}`)
    })

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
      yield* Console.log("Заблокированных компаний не найдено (или сессия устарела: выполните otbor hh login).")
      return
    }

    const imported = yield* api.BlacklistImportHh({ hhAccountId: account as any, entries })
    yield* Console.log(`Импортировано: ${imported.imported}, обновлено: ${imported.updated}, пропущено: ${imported.skipped}`)
  })
).pipe(Command.withDescription("Scrape hh.ru blacklist using saved session"))