import type { KeywordId } from "@otbor/contract"
import { normalizeTerm } from "@otbor/domain"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const list = Command.make(
  "list",
  {
    query: Flag.String("query").pipe(
      Flag.withDescription("Filter terms and aliases by substring"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(50)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ query, limit, json }) {
    const api = yield* Api
    const keywords = yield* api.LexiconList({
      query: Option.getOrUndefined(query),
      limit
    })

    if (json) {
      yield* Console.log(JSON.stringify(keywords, null, 2))
      return
    }
    if (keywords.length === 0) {
      yield* Console.log("No keywords.")
      return
    }

    yield* Console.log(
      table(
        ["id", "term", "aliases"],
        keywords.map((keyword) => [
          shortId(keyword.id),
          keyword.term,
          `${keyword.aliases.length}`
        ])
      )
    )
  })
).pipe(Command.withDescription("List lexicon keywords"))

const add = Command.make(
  "add",
  {
    term: Argument.String("term").pipe(Argument.withDescription("Canonical term")),
    aliases: Flag.String("alias").pipe(
      Flag.withDescription("Additional form of the same term (repeatable)"),
      Flag.between(0, 50)
    )
  },
  Effect.fn(function*({ term, aliases }) {
    const api = yield* Api
    const keyword = yield* api.LexiconUpsert({
      term,
      aliases
    })
    yield* Console.log(`${keyword.id}  ${keyword.term}  (${keyword.aliases.length} alias(es))`)
  })
).pipe(Command.withDescription("Add or update a keyword"))

const remove = Command.make(
  "rm",
  {
    keyword: Argument.String("keyword").pipe(
      Argument.withDescription("Keyword id, id prefix, or exact term")
    )
  },
  Effect.fn(function*({ keyword }) {
    const api = yield* Api
    const all = yield* api.LexiconList({ limit: 5000 })
    const normalized = normalizeTerm(keyword)
    const matches = all.filter(
      (item) =>
        item.id === keyword ||
        item.id.startsWith(keyword) ||
        item.normalizedTerm === normalized
    )
    const [match] = matches
    if (match === undefined) {
      yield* Effect.fail(new Error(`No keyword matches "${keyword}"`))
      return
    }
    if (matches.length > 1) {
      yield* Effect.fail(
        new Error(
          `"${keyword}" matches ${matches.length} keywords: ${matches
            .map((item) => `${shortId(item.id)} ${item.term}`)
            .join(", ")}`
        )
      )
      return
    }

    yield* api.LexiconRemove({ id: match.id as KeywordId })
    yield* Console.log(`Removed ${match.term} (${match.id})`)
  })
).pipe(Command.withDescription("Remove a keyword and its aliases"))

export const lexiconCommand = Command.make("lexicon").pipe(
  Command.withSubcommands([list, add, remove]),
  Command.withDescription("The keyword lexicon")
)
