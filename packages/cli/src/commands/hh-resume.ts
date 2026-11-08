import type { CaptchaEpisode } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { table } from "../format.ts"
import { resolveAccount } from "./filter.ts"

/** «капча после N откликов за M мин» по одному эпизоду. */
export const describeEpisode = (episode: CaptchaEpisode): string => {
  const minutes =
    episode.firstSubmitAt === null || episode.lastSubmitAt === null
      ? 0
      : Math.max(0, Math.round((Date.parse(episode.lastSubmitAt) - Date.parse(episode.firstSubmitAt)) / 60_000))
  return `капча после ${episode.submitsConfirmed} откликов за ${minutes} мин`
}

export const hhResumeCommand = Command.make(
  "resume",
  {
    account: Argument.String("account").pipe(
      Argument.withDescription("hh account: id, id prefix or label (default: the default or the only account)"),
      Argument.optional
    )
  },
  Effect.fn(function*({ account }) {
    const api = yield* Api
    const hhAccountId = yield* resolveAccount(account)
    const before = (yield* api.HhAccountsList()).find((a) => a.id === hhAccountId)
    if (before?.submitBlockedAt == null) {
      yield* Console.log("Отправки этого аккаунта не остановлены, возобновлять нечего.")
      return
    }
    const result = yield* api.HhAccountSubmitResume({ hhAccountId })
    yield* Console.log(
      `Отправки аккаунта ${result.account.label} возобновлены. Автозаявок, ждавших капчу, вернулось раннеру: ${result.released}.`
    )
    yield* Console.log(
      "Если hh снова покажет капчу, отправки остановятся снова: решите её в профиле (otbor hh login --profile <профиль>)."
    )
  })
).pipe(
  Command.withDescription(
    "Resume the submits of an account after you solved the hh captcha in its browser profile (otbor hh login --profile <name>)"
  )
)

export const hhCaptchaCommand = Command.make(
  "captcha",
  {
    account: Argument.String("account").pipe(Argument.optional),
    limit: Flag.Int("limit").pipe(Flag.withDefault(10))
  },
  Effect.fn(function*({ account, limit }) {
    const api = yield* Api
    const hhAccountId = Option.isSome(account) ? yield* resolveAccount(account) : undefined
    const episodes = yield* api.HhCaptchaEpisodesList({ hhAccountId, limit })
    if (episodes.length === 0) {
      yield* Console.log("Капчи ещё не было.")
      return
    }
    yield* Console.log(
      table(
        ["captcha at", "resumed", "what"],
        episodes.map((e) => [e.captchaAt, e.resumedAt ?? "waiting for you", describeEpisode(e)])
      )
    )
  })
).pipe(Command.withDescription("Captcha episodes: how many responses hh allowed before asking"))
