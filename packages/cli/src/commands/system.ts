import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

const health = Command.make(
  "health",
  {
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const result = yield* api.SystemHealth()

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    yield* Console.log(`status: ${result.status}`)
    yield* Console.log(`version: ${result.version}`)
    yield* Console.log(`database: ${result.database ? "ok" : "down"}`)
    yield* Console.log(`now: ${result.now}`)
  })
).pipe(Command.withDescription("Check the API and its database"))

export const healthCommand = health
