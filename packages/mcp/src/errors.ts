import { Effect, Predicate, Schema } from "effect"
import { Api } from "./api.ts"
import { formatIssues } from "./apply.ts"

/**
 * The single failure every tool declares. `message` is what the model reads,
 * so it is a sentence, not a stack trace.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()("ToolFailure", {
  message: Schema.String
}) {}

export const unreachableMessage = (url: string) => `otbor API is not reachable at ${url}; run \`otbor up\``

const describe = (error: unknown): string => {
  if (Predicate.isTagged(error, "NotFound")) {
    const e = error as unknown as { entity: string; id: string }
    return `${e.entity} not found: ${e.id}`
  }
  if (Predicate.isTagged(error, "Unauthorized")) return `unauthorized: ${(error as unknown as { message: string }).message}`
  if (Predicate.isTagged(error, "InvalidInput")) return `invalid input: ${(error as unknown as { message: string }).message}`
  if (Predicate.isTagged(error, "Conflict")) return `conflict: ${(error as unknown as { message: string }).message}`
  if (Predicate.isTagged(error, "AnswersInvalid")) {
    const e = error as unknown as { problems: ReadonlyArray<{ code: string; questionId: string; message: string }> }
    return `the kit cannot be approved:\n${formatIssues(e.problems).map((line) => `- ${line}`).join("\n")}\nFix it with kit_set (see application_form), then approve again.`
  }
  if (Predicate.isTagged(error, "LimitExceeded")) {
    const e = error as unknown as { limit: number; used: number; resetsAt: string }
    return `daily apply limit reached for this hh account: ${e.used} of ${e.limit} used in the last 24 hours; the next slot frees at ${e.resetsAt}. Nothing was sent. Tell the user; do not retry.`
  }
  if (error instanceof Error && error.message.trim() !== "") return error.message
  const json = JSON.stringify(error)
  return json === undefined ? String(error) : json
}

/**
 * Turns any RPC outcome into a `ToolFailure`. A transport failure becomes the
 * actionable "API is down" sentence; the MCP server itself keeps running.
 */
export const guard = (api: Api["Service"]) => <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ToolFailure, R> =>
  Effect.gen(function*() {
    return yield* effect.pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((error) =>
        Effect.fail(
          new ToolFailure({
            message: Predicate.isTagged(error, "RpcClientError") || Predicate.isTagged(error, "TimeoutError")
              ? unreachableMessage(api.url)
              : describe(error)
          })
        )
      )
    )
  })
