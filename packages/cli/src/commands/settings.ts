import type { UserSettings } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

const lines = (settings: UserSettings, defaults: UserSettings) => {
  const row = (label: string, value: unknown, fallback: unknown) =>
    `${label.padEnd(34)} ${String(value ?? "off").padEnd(6)} (default ${String(fallback ?? "off")})`
  return [
    row("browser jobs per account", settings.accountBrowserConcurrency, defaults.accountBrowserConcurrency),
    row("acting jobs per account", settings.accountActingConcurrency, defaults.accountActingConcurrency),
    row("submit interval, seconds", settings.submitIntervalSeconds, defaults.submitIntervalSeconds),
    row("submit jitter, percent", settings.submitJitterPercent, defaults.submitJitterPercent),
    row("submits per hour per account", settings.submitHourlyLimit, defaults.submitHourlyLimit),
    row("harness slots", settings.harnessSlots, defaults.harnessSlots),
    row("form reads per account", settings.formReadConcurrency, defaults.formReadConcurrency),
    row("form read interval, seconds", settings.formReadIntervalSeconds, defaults.formReadIntervalSeconds),
    row("form read jitter, percent", settings.formReadJitterPercent, defaults.formReadJitterPercent),
    row("form read slowdown on captcha", settings.formReadBlockedFactor, defaults.formReadBlockedFactor)
  ]
}

const get = Command.make(
  "get",
  { json: Flag.Boolean("json").pipe(Flag.withDefault(false)) },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const view = yield* api.SettingsGet({})
    if (json) {
      yield* Console.log(JSON.stringify(view, null, 2))
      return
    }
    for (const line of lines(view.settings, view.defaults)) yield* Console.log(line)
    yield* Console.log(view.stored ? `saved ${view.updatedAt}` : "nothing saved: the defaults apply")
  })
).pipe(Command.withDescription("Show the apply and browser settings"))

const set = Command.make(
  "set",
  {
    browser: Flag.Int("browser").pipe(Flag.withDescription("Browser jobs per account, 1-12"), Flag.optional),
    acting: Flag.Int("acting").pipe(Flag.withDescription("Acting jobs per account, 1-12"), Flag.optional),
    interval: Flag.Int("interval").pipe(Flag.withDescription("Submit interval, seconds, 0-3600"), Flag.optional),
    jitter: Flag.Int("jitter").pipe(Flag.withDescription("Interval jitter, percent, 0-200"), Flag.optional),
    hourly: Flag.Int("hourly").pipe(
      Flag.withDescription("Submits per hour per account, 1-1000; 0 turns the limit off"),
      Flag.optional
    ),
    slots: Flag.Int("slots").pipe(Flag.withDescription("Harness slots, 1-12"), Flag.optional),
    reads: Flag.Int("reads").pipe(Flag.withDescription("Form reads per account at once, 1-12"), Flag.optional),
    readInterval: Flag.Int("read-interval").pipe(Flag.withDescription("Form read interval, seconds, 0-600"), Flag.optional),
    readJitter: Flag.Int("read-jitter").pipe(Flag.withDescription("Form read jitter, percent, 0-200"), Flag.optional),
    readCaptchaFactor: Flag.Int("read-captcha-factor").pipe(
      Flag.withDescription("Form read slowdown while a captcha blocks the account, 1-20"),
      Flag.optional
    )
  },
  Effect.fn(function*({ browser, acting, interval, jitter, hourly, slots, reads, readInterval, readJitter, readCaptchaFactor }) {
    const api = yield* Api
    const current = (yield* api.SettingsGet({})).settings
    const view = yield* api.SettingsUpdate({
      accountBrowserConcurrency: Option.getOrElse(browser, () => current.accountBrowserConcurrency),
      accountActingConcurrency: Option.getOrElse(acting, () => current.accountActingConcurrency),
      submitIntervalSeconds: Option.getOrElse(interval, () => current.submitIntervalSeconds),
      submitJitterPercent: Option.getOrElse(jitter, () => current.submitJitterPercent),
      submitHourlyLimit: Option.isSome(hourly) ? (hourly.value === 0 ? null : hourly.value) : current.submitHourlyLimit,
      harnessSlots: Option.getOrElse(slots, () => current.harnessSlots),
      formReadConcurrency: Option.getOrElse(reads, () => current.formReadConcurrency),
      formReadIntervalSeconds: Option.getOrElse(readInterval, () => current.formReadIntervalSeconds),
      formReadJitterPercent: Option.getOrElse(readJitter, () => current.formReadJitterPercent),
      formReadBlockedFactor: Option.getOrElse(readCaptchaFactor, () => current.formReadBlockedFactor),
      analysisEnabled: current.analysisEnabled
    })
    for (const line of lines(view.settings, view.defaults)) yield* Console.log(line)
  })
).pipe(Command.withDescription("Change settings; they apply without a restart"))

export const settingsCommand = Command.make("settings").pipe(
  Command.withSubcommands([get, set]),
  Command.withDescription("Apply pace, per-account concurrency and harness slots (stored in the database)")
)
