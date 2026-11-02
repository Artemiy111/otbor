import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const storagePath = () => process.env.OTBOR_HH_STORAGE_STATE?.trim() || join(homedir(), ".otbor", "hh", "storage-state.json")

export const hhLoginCommand = Command.make(
  "login",
  {
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Login wait timeout, seconds"),
      Flag.withDefault(300)
    )
  },
  Effect.fn(function*({ timeout }) {
    const profileDir = join(homedir(), ".otbor", "hh", "profile")
    const context = yield* Effect.tryPromise({
      try: () => chromium.launchPersistentContext(profileDir, {
        headless: false,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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

    yield* Console.log("Войдите в аккаунт hh.ru в открывшемся браузере. После входа нажмите Enter в этом терминале (или дождитесь автопроверки).")

    const enterPressed = new Promise<void>((resolve) => {
      const onData = () => { process.stdin.off("data", onData); resolve() }
      process.stdin.resume()
      process.stdin.on("data", onData)
    })

    const deadline = Date.now() + timeout * 1000
    let loggedIn = false
    while (Date.now() < deadline && !loggedIn) {
      const cookies = yield* Effect.tryPromise({
        try: () => context.cookies("https://hh.ru"),
        catch: (error) => new Error(`cookies failed: ${error}`)
      })
      if (cookies.some((c) => c.name === "hhtoken" || c.name === "hhul")) { loggedIn = true; break }
      // race: wait 2s or Enter
      yield* Effect.promise(() => Promise.race([enterPressed, new Promise((r) => setTimeout(r, 2000))]))
      const cookies2 = yield* Effect.tryPromise({
        try: () => context.cookies("https://hh.ru"),
        catch: (error) => new Error(`cookies failed: ${error}`)
      })
      if (cookies2.some((c) => c.name === "hhtoken" || c.name === "hhul")) { loggedIn = true; break }
      // if Enter pressed, break regardless
      // (enterPressed resolved) -> check url
      if (page.url().includes("hh.ru") && !page.url().includes("/login")) {
        // maybe logged in
      }
    }

    const state = yield* Effect.tryPromise({
      try: () => context.storageState(),
      catch: (error) => new Error(`storageState failed: ${error}`)
    })

    const path = storagePath()
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true })
        await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 })
      },
      catch: (error) => new Error(`save failed: ${error}`)
    })

    yield* Effect.tryPromise({ try: () => context.close(), catch: () => new Error("close failed") })
    yield* Console.log(`Сессия сохранена: ${path}`)
  })
).pipe(Command.withDescription("Log in to hh.ru and save session"))
