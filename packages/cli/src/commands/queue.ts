import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { formatJob, table } from "../format.ts"

const stats = Command.make(
  "stats",
  {
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ json }) {
    const api = yield* Api
    const result = yield* api.QueueStatsGet()

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    yield* Console.log(`pending:         ${result.pending}`)
    yield* Console.log(`leased:          ${result.leased}`)
    yield* Console.log(`running:         ${result.running}`)
    yield* Console.log(`done:            ${result.done}`)
    yield* Console.log(`failed:          ${result.failed}`)
    yield* Console.log(`dead:            ${result.dead}`)
    yield* Console.log(`needs_human:     ${result.needsHuman}`)
    yield* Console.log(`needs_reconcile: ${result.needsReconcile}`)
    yield* Console.log(`oldest pending:  ${result.oldestPendingAgeSeconds}s`)
  })
).pipe(Command.withDescription("Queue counters"))

const jobs = Command.make(
  "jobs",
  {
    status: Flag.String("status").pipe(
      Flag.withDescription("Filter by job status (pending, leased, running, done, ...)"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ status, limit, json }) {
    const api = yield* Api
    const items = yield* api.QueueJobsList({ status: Option.getOrUndefined(status), limit })

    if (json) {
      yield* Console.log(JSON.stringify(items, null, 2))
      return
    }
    if (items.length === 0) {
      yield* Console.log("No jobs.")
      return
    }

    yield* Console.log(
      table(["id", "kind", "stage", "status", "attempts", "lease", "run at"], items.map(formatJob))
    )
  })
).pipe(Command.withDescription("List harness jobs"))

export const queueCommand = Command.make("queue").pipe(
  Command.withSubcommands([stats, jobs]),
  Command.withDescription("Harness queue state")
)
