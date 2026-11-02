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

    yield* Effect.tryPromise({ try: () => browser.close(), catch: () => new Error("close failed") })
    yield* Console.log(`Сессия сохранена: ${path}`)
  })
).pipe(Command.withDescription("Log in to hh.ru and save session"))
