import { Api } from "../client.ts"
import { fullName, isReplaceableLabel, parseProfileName } from "../hh-session.ts"
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { chromium } from "playwright"

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
    // Профиля на диске нет: вход идёт в обычном окне, а cookies уходят в облако.
    const browser = yield* Effect.tryPromise({
      try: () => chromium.launch({
        headless: false,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ignoreDefaultArgs: ["--no-sandbox"]
      }),
      catch: (error) => new Error(`browser launch failed: ${error}`)
    })
    const context = yield* Effect.tryPromise({
      try: () => browser.newContext(),
      catch: (error) => new Error(`context failed: ${error}`)
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
      yield* Effect.tryPromise({ try: () => browser.close(), catch: () => new Error("close failed") })
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
    const { firstName, lastName } = parseProfileName(profileHtml)
    const hhid = homeHtml.match(/"hhid":\s*"([^"]+)"/)?.[1] ?? null
    const resolvedProfile = hhid ? `hh_${hhid}` : (firstName && lastName ? `${firstName}_${lastName}`.toLowerCase() : "default")

    yield* Effect.tryPromise({ try: () => browser.close(), catch: () => new Error("close failed") })

    const hhName = fullName({ firstName, lastName }) || (hhid ? `hh ${hhid}` : "hh account")
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    // Same session profile means same account: update it, never duplicate.
    const existing = accounts.find((a) => a.id === account) ??
      accounts.find((a) => a.sessionProfile === resolvedProfile)
    const createdAccount = yield* api.HhAccountUpsert({
      ...(existing ? { id: existing.id } : {}),
      // a label the operator chose is never overwritten
      label: existing && !isReplaceableLabel(existing.label) ? existing.label : hhName,
      sessionProfile: resolvedProfile,
      firstName: firstName ?? existing?.firstName ?? undefined,
      lastName: lastName ?? existing?.lastName ?? undefined,
      isDefault: existing ? existing.isDefault : true
    })
    yield* api.HhAccountSessionStatePut({ id: createdAccount.id, state: JSON.stringify(state) })
    yield* api.HhAccountSessionSet({ id: createdAccount.id, state: "ok" })
    yield* Console.log("Сессия сохранена в облаке (cookies зашифрованы).")
    yield* Console.log(`Аккаунт: ${createdAccount.label} (${createdAccount.id})`)
  })
).pipe(Command.withDescription("Log in to hh.ru and save session"))
