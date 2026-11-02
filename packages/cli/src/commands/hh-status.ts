import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const storagePath = () => process.env.OTBOR_HH_STORAGE_STATE?.trim() || join(homedir(), ".otbor", "hh", "storage-state.json")

export const hhStatusCommand = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    const path = storagePath()
    let state: any
    try {
      const text = yield* Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: () => new Error("missing") })
      state = JSON.parse(text)
    } catch {
      yield* Console.log(`Сессия hh.ru не найдена: ${path}`)
      yield* Console.log("Выполните: otbor hh login")
      return
    }

    const cookies = (state.cookies ?? []).filter((c: any) => String(c.domain || "").includes("hh.ru"))
    const token = cookies.find((c: any) => c.name === "hhtoken" || c.name === "hhul")
    const expires = token?.expires ? new Date(token.expires * 1000) : null
    const now = new Date()
    const expired = expires !== null && expires < now

    yield* Console.log(`Файл сессии: ${path}`)
    yield* Console.log(`Cookies hh.ru: ${cookies.length}`)
    yield* Console.log(`Токен: ${token?.name ?? "нет"} (истекает: ${expires ? expires.toISOString() : "неизвестно"})`)
    yield* Console.log(`Локальный статус: ${expired ? "ИСТЁК" : "валиден"}`)

    // Verify online
    const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ")
    const response = yield* Effect.tryPromise({
      try: () => fetch("https://hh.ru/applicant/resumes", {
        headers: { Cookie: cookieHeader, "User-Agent": "Mozilla/5.0" },
        redirect: "follow"
      }),
      catch: (error) => new Error(`fetch failed: ${error}`)
    })
    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => new Error("read failed")
    })
    const anonymous = /"userType":\s*"anonymous"/.test(html)
    yield* Console.log(`Проверка hh.ru: ${response.status} ${anonymous ? "(аноним — сессия недействительна)" : "(авторизован)"}`)
  })
).pipe(Command.withDescription("Check hh.ru session status"))