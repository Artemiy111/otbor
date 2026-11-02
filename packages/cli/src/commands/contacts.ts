import type { ContactId, ContactKind, ContactSource } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const kinds = ["email", "telegram", "phone", "hh_chat", "other"] as const
const sources = ["hh_vacancy", "mail", "telegram", "hh_chat", "manual"] as const

const asKind = (value: string | undefined): ContactKind | undefined =>
  value === undefined || !kinds.includes(value as ContactKind)
    ? undefined
    : (value as ContactKind)

const asSource = (value: string | undefined): ContactSource | undefined =>
  value === undefined || !sources.includes(value as ContactSource)
    ? undefined
    : (value as ContactSource)

const list = Command.make(
  "list",
  {
    query: Flag.String("query").pipe(
      Flag.withDescription("Search person name or value"),
      Flag.optional
    ),
    kind: Flag.String("kind").pipe(
      Flag.withDescription(`One of: ${kinds.join(", ")}`),
      Flag.optional
    ),
    source: Flag.String("source").pipe(
      Flag.withDescription(`One of: ${sources.join(", ")}`),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(100)),
    offset: Flag.Int("offset").pipe(Flag.withDefault(0)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ query, kind, source, limit, offset, json }) {
    const api = yield* Api
    const result = yield* api.ContactsList({
      query: Option.getOrUndefined(query),
      kind: asKind(Option.getOrUndefined(kind)),
      source: asSource(Option.getOrUndefined(source)),
      limit,
      offset
    })

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.items.length === 0) {
      yield* Console.log("No contacts.")
      return
    }

    yield* Console.log(
      table(
        ["id", "kind", "value", "name", "source", "vacancy", "last seen"],
        result.items.map((contact) => [
          shortId(contact.id),
          contact.kind,
          contact.value,
          contact.personName ?? "-",
          contact.source,
          contact.vacancyId === null ? "-" : shortId(contact.vacancyId),
          contact.lastSeenAt.slice(0, 16).replace("T", " ")
        ])
      )
    )
    yield* Console.log(`\n${result.total} contact(s)`)
  })
).pipe(Command.withDescription("List extracted contacts"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Contact id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.ContactRemove({ id: id as ContactId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Delete a contact"))

export const contactsCommand = Command.make("contacts").pipe(
  Command.withSubcommands([list, remove]),
  Command.withDescription("Contacts extracted from vacancies, mail and Telegram")
)
