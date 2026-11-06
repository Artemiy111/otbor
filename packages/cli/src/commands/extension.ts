import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { repoRoot } from "../stack.ts"

const ADDON_ID = "otbor@art.local"
const EXT_DIR = join(repoRoot, "apps/extension")

/** Unsigned add-ons dropped into a profile are only loaded with these set. */
const USER_PREFS = [
  'user_pref("xpinstall.signatures.required", false);',
  'user_pref("extensions.autoDisableScopes", 0);',
  'user_pref("extensions.enabledScopes", 15);'
]

const run = (cmd: ReadonlyArray<string>, cwd: string): void => {
  const result = Bun.spawnSync([...cmd], { cwd, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} завершилась с кодом ${result.exitCode}`)
}

const build = (): void => run(["bun", "build.ts"], EXT_DIR)

/* ------------------------------------ Zen ------------------------------------ */

const zenRunning = (): boolean =>
  Bun.spawnSync(["pgrep", "-f", "/Applications/Zen.app/Contents/MacOS/zen"]).exitCode === 0

const runningZenProfile = (): string | null => {
  const ps = Bun.spawnSync(["ps", "-ax", "-o", "command="]).stdout.toString()
  for (const line of ps.split("\n")) {
    if (!line.includes("/Applications/Zen.app/Contents/MacOS/")) continue
    const path = line.match(/-profile (\/Users\/.*?\/zen\/Profiles\/.*?)(?: org\.mozilla| -|$)/)?.[1]
    if (path !== undefined && existsSync(path)) return path
  }
  return null
}

const findZenProfile = (): string | null => {
  const running = runningZenProfile()
  if (running !== null) return running
  const root = join(homedir(), "Library/Application Support/zen")
  const ini = join(root, "profiles.ini")
  if (existsSync(ini)) {
    let section = ""
    for (const raw of readFileSync(ini, "utf8").split("\n")) {
      const line = raw.trim()
      if (line.startsWith("[")) section = line
      if (section.startsWith("[Install") && line.startsWith("Default=")) {
        const value = line.slice("Default=".length).trim()
        const path = isAbsolute(value) ? value : join(root, value)
        if (existsSync(path)) return path
      }
    }
  }
  const profiles = join(root, "Profiles")
  if (!existsSync(profiles)) return null
  return (
    readdirSync(profiles, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(profiles, entry.name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
  )
}

const writeUserPrefs = (profile: string): void => {
  const userJs = join(profile, "user.js")
  const lines = new Set(
    (existsSync(userJs) ? readFileSync(userJs, "utf8") : "").split("\n").map((l) => l.trim()).filter(Boolean)
  )
  for (const pref of USER_PREFS) lines.add(pref)
  writeFileSync(userJs, `${[...lines].join("\n")}\n`)
}

const zenState = (profile: string): string => {
  try {
    const data = JSON.parse(readFileSync(join(profile, "extensions.json"), "utf8")) as {
      addons?: Array<{ id?: string; active?: boolean; userDisabled?: boolean; appDisabled?: boolean }>
    }
    const addon = data.addons?.find((a) => a.id === ADDON_ID)
    if (addon === undefined) return "не установлено"
    if (addon.active) return "активно"
    if (addon.appDisabled) return "заблокировано браузером"
    if (addon.userDisabled) return "выключено пользователем"
    return "установлено, не активно"
  } catch {
    return "не установлено"
  }
}

const installZen = Effect.fn(function*(options: { profile?: string; restart: boolean }) {
  const profile = options.profile === undefined ? findZenProfile() : resolve(options.profile)
  if (profile === null) {
    return yield* Effect.fail(new Error("Не нашёл профиль Zen. Укажите --profile <путь>."))
  }
  yield* Console.log(`Профиль Zen: ${profile}`)

  const source = join(EXT_DIR, "dist/firefox")
  const xpi = join(EXT_DIR, "dist", `${ADDON_ID}.xpi`)
  rmSync(xpi, { force: true })
  // An XPI is a zip with manifest.json at its root.
  run(["zip", "-qr", xpi, "."], source)

  mkdirSync(join(profile, "extensions"), { recursive: true })
  const target = join(profile, "extensions", `${ADDON_ID}.xpi`)
  copyFileSync(xpi, target)
  writeUserPrefs(profile)
  yield* Console.log(`XPI: ${target} (${(statSync(target).size / 1024).toFixed(0)} КБ)`)

  if (!zenRunning()) {
    yield* Console.log("Zen не запущен — расширение загрузится при следующем старте.")
    return
  }
  if (!options.restart) {
    yield* Console.log("Zen запущен и держит старую версию. Перезапустите его или повторите с --restart.")
    return
  }
  yield* Console.log("Перезапускаю Zen…")
  Bun.spawnSync(["osascript", "-e", 'tell application "Zen" to quit'])
  for (let i = 0; i < 40 && zenRunning(); i += 1) yield* Effect.sleep("250 millis")
  Bun.spawnSync(["open", "-a", "Zen"])
  for (let i = 0; i < 30; i += 1) {
    if (zenState(profile) === "активно") break
    yield* Effect.sleep("500 millis")
  }
  yield* Console.log(`Расширение: ${zenState(profile)}`)
})

/* ----------------------------------- Chrome ---------------------------------- */

const installChrome = Effect.fn(function*() {
  const dir = join(EXT_DIR, "dist/chrome")
  // Chrome 137+ ignores --load-extension and refuses a debug port on the
  // default profile, and a policy install needs MDM. "Load unpacked" is the one
  // manual step; Chrome remembers the folder, so rebuilding is enough afterwards.
  Bun.spawnSync(["pbcopy"], { stdin: new TextEncoder().encode(dir) })
  yield* Console.log(`Сборка Chrome: ${dir}`)
  yield* Console.log("Путь скопирован в буфер обмена.")
  if (existsSync("/Applications/Google Chrome.app")) {
    Bun.spawnSync(["open", "-a", "Google Chrome", "chrome://extensions"])
  }
  yield* Console.log("Один раз: включите «Режим разработчика» → «Загрузить распакованное» → вставьте путь (⌘⇧G).")
  yield* Console.log("Дальше Chrome помнит папку: после `otbor extension build` нажмите ⟳ на карточке или перезапустите браузер.")
})

/* ---------------------------------- commands --------------------------------- */

const buildCmd = Command.make(
  "build",
  {},
  Effect.fn(function*() {
    yield* Effect.sync(build)
  })
).pipe(Command.withDescription("Собрать расширение для Chrome и Zen"))

const installCmd = Command.make(
  "install",
  {
    browser: Flag.Literals("browser", ["zen", "chrome", "all"]).pipe(
      Flag.withDescription("zen | chrome | all"),
      Flag.withDefault("all")
    ),
    profile: Flag.String("profile").pipe(Flag.withDescription("Путь к профилю Zen"), Flag.optional),
    restart: Flag.Boolean("restart").pipe(
      Flag.withDescription("Перезапускать запущенный Zen (по умолчанию да)"),
      Flag.withDefault(true)
    )
  },
  Effect.fn(function*({ browser, profile, restart }) {
    yield* Console.log("Собираю расширение…")
    yield* Effect.sync(build)
    if (browser === "zen" || browser === "all") {
      yield* installZen({
        restart,
        ...(profile._tag === "Some" ? { profile: profile.value } : {})
      })
    }
    if (browser === "chrome" || browser === "all") yield* installChrome()
  })
).pipe(Command.withDescription("Установить расширение в Zen автоматически, в Chrome — подготовить"))

export const extensionCommand = Command.make("extension").pipe(
  Command.withSubcommands([buildCmd, installCmd]),
  Command.withDescription("Расширение браузера: сборка и установка")
)
