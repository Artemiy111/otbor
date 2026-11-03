import { Api } from "../client.ts"
import { hhProfileDir } from "@otbor/harness"
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const profileDir = (name: string) => hhProfileDir(name)
const storagePath = (name: string) => join(profileDir(name), "storage-state.json")

export const hhLoginCommand = Command.make(
  "login",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id to bind session to"),
      Flag.withDefault("")
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Profile name for this hh.ru account"),
      Flag.withDefault("default")
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Login wait timeout, seconds"),
      Flag.withDefault(600)
    )
  },
  Effect.fn(function*({ account, profile, timeout }) {
    const profileDirPath = profileDir(profile)
    const context = yield* Effect.tryPromise({
      try: () => chromium.launchPersistentContext(profileDirPath, {
        headless: false,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ignoreDefaultArgs: ["--no-sandbox"]
      }),
      catch: (error) => new Error(`browser launch failed: ${error}`)
    })
    const page = context.pages()[0] ?? (yield* Effect.tryPromise({
      try: () => context.newPage(),
      catch: (error) => new Error(`page failed: ${error}`)
    }))

    yield* Effect.tryPromise({
      try: () => page.goto("https://hh.ru/login"),
      catch: (error) => new Error(`goto failed: ${error}`)
    })

    yield* Console.log("Войдите в аккаунт hh.ru в открывшемся браузере. Автопроверка каждые 2 сек.")

    const deadline = Date.now() + timeout * 1000
    let loggedIn = false
    while (Date.now() < deadline && !loggedIn) {
      const url = page.url()
      const cookies = yield* Effect.tryPromise({
        try: () => context.cookies("https://hh.ru"),
        catch: (error) => new Error(`cookies failed: ${error}`)
      })
      const names = cookies.map((c) => c.name).join(", ")
      yield* Console.log(`[check] url=${url} cookies=${names}`)

      const hasUserToken = cookies.some((c) => c.name === "hhul")
      const onAccount = /hh\.ru\/(applicant|vacancy|resume)/.test(url) && !url.includes("/login")
      if (hasUserToken || onAccount) {
        loggedIn = true
        break
      }
      yield* Effect.sleep("2 seconds")
    }

    if (!loggedIn) {
      yield* Effect.tryPromise({ try: () => context.close(), catch: () => new Error("close failed") })
      return yield* Effect.fail(new Error("login timeout"))
    }

    const state = yield* Effect.tryPromise({
      try: () => context.storageState(),
      catch: (error) => new Error(`storageState failed: ${error}`)
    })

    // Fetch profile from hh.ru to identify account automatically
    const profileHtml = yield* Effect.tryPromise({
      try: async () => {
        const res = await context.request.get("https://hh.ru/applicant/profile/me")
        return await res.text()
      },
      catch: () => ""
    })
    const homeHtml = yield* Effect.tryPromise({
      try: async () => {
        const res = await context.request.get("https://hh.ru/")
        return await res.text()
      },
      catch: () => ""
    })
    const firstName = profileHtml.match(/firstName&quot;:&quot;([^&]+)&quot;/)?.[1]?.replace(/&quot;/g, "") ?? null
    const lastName = profileHtml.match(/lastName&quot;:&quot;([^&]+)&quot;/)?.[1]?.replace(/&quot;/g, "") ?? null
    const hhid = homeHtml.match(/"hhid":\s*"([^"]+)"/)?.[1] ?? null
    const resolvedProfile = hhid ? `hh_${hhid}` : (firstName && lastName ? `${firstName}_${lastName}`.toLowerCase() : "default")

    const path = storagePath(resolvedProfile)
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true })
        await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 })
      },
      catch: (error) => new Error(`save failed: ${error}`)
    })

    yield* Effect.tryPromise({ try: () => context.close(), catch: () => new Error("close failed") })

    const label = [firstName, lastName].filter(Boolean).join(" ") || (hhid ? `hh ${hhid}` : "hh account")
    const api = yield* Api
    const createdAccount = yield* api.HhAccountUpsert({
      label,
      sessionProfile: resolvedProfile,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      isDefault: true
    })
    yield* Console.log(`Сессия сохранена: ${path}`)
    yield* Console.log(`Аккаунт: ${createdAccount.label} (${createdAccount.id})`)
  })
).pipe(Command.withDescription("Log in to hh.ru and save session"))
