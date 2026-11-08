import type { ContactId, PersonId, PersonRecord } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const json = Flag.Boolean("json").pipe(Flag.withDefault(false))

const isFullId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value) && value.length === 36

/** В таблицах печатается короткий id, поэтому команды принимают и префикс. */
const resolvePerson = Effect.fn(function*(prefix: string) {
  if (isFullId(prefix)) return prefix as PersonId
  const api = yield* Api
  const { items } = yield* api.PersonList({ limit: 500, offset: 0 })
  const found = items.filter((person) => person.id.startsWith(prefix))
  if (found.length === 1 && found[0] !== undefined) return found[0].id
  return yield* Effect.fail(
    new Error(found.length === 0 ? `человек ${prefix} не найден` : `префикс ${prefix} неоднозначен`)
  )
})

const resolveContact = Effect.fn(function*(prefix: string) {
  if (isFullId(prefix)) return prefix as ContactId
  const api = yield* Api
  const { items } = yield* api.ContactsList({ limit: 500, offset: 0 })
  const found = items.filter((contact) => contact.id.startsWith(prefix))
  if (found.length === 1 && found[0] !== undefined) return found[0].id
  return yield* Effect.fail(
    new Error(found.length === 0 ? `контакт ${prefix} не найден` : `префикс ${prefix} неоднозначен`)
  )
})

const printPerson = Effect.fn(function*(person: PersonRecord) {
  yield* Console.log(
    [
      `${person.displayName ?? "(без имени)"}  ${person.id}`,
      `роль: ${person.role ?? "-"}  компания: ${person.employerId ?? "-"}`,
      `заметки: ${person.notes ?? "-"}`,
      `вакансий: ${person.vacancyIds.length}  резюме: ${person.resumeIds.length}`
    ].join("\n")
  )
  yield* Console.log("\nконтакты:")
  yield* Console.log(
    person.contacts.length === 0
      ? "-"
      : table(
          ["id", "kind", "value", "source", "link", "confidence"],
          person.contacts.map((contact) => [
            shortId(contact.id),
            contact.kind,
            contact.value,
            contact.source,
            contact.personLink ?? "-",
            contact.confidence === null ? "-" : contact.confidence.toFixed(2)
          ])
        )
  )
  yield* Console.log("\nдиалоги:")
  yield* Console.log(
    person.conversations.length === 0
      ? "-"
      : table(
          ["id", "channel", "title", "last", "vacancy"],
          person.conversations.map((conversation) => [
            shortId(conversation.id),
            conversation.channel,
            conversation.title ?? conversation.externalId,
            (conversation.lastMessageAt ?? "-").slice(0, 16).replace("T", " "),
            conversation.vacancyId === null ? "-" : shortId(conversation.vacancyId)
          ])
        )
  )
})

const list = Command.make(
  "list",
  {
    query: Flag.String("query").pipe(
      Flag.withDescription("Search name, role or contact value"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(100)),
    offset: Flag.Int("offset").pipe(Flag.withDefault(0)),
    json
  },
  Effect.fn(function*({ query, limit, offset, json }) {
    const api = yield* Api
    const result = yield* api.PersonList({ query: Option.getOrUndefined(query), limit, offset })
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.items.length === 0) {
      yield* Console.log("No people.")
      return
    }
    yield* Console.log(
      table(
        ["id", "name", "role", "contacts", "dialogs", "last seen"],
        result.items.map((person) => [
          shortId(person.id),
          person.displayName ?? "-",
          person.role ?? "-",
          String(person.contactCount),
          String(person.conversationCount),
          (person.lastSeenAt ?? "-").slice(0, 16).replace("T", " ")
        ])
      )
    )
    yield* Console.log(`\n${result.total} person(s)`)
  })
).pipe(Command.withDescription("List people"))

const show = Command.make(
  "show",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Person id or id prefix")),
    json
  },
  Effect.fn(function*({ id, json }) {
    const api = yield* Api
    const person = yield* api.PersonGet({ id: yield* resolvePerson(id) })
    if (json) {
      yield* Console.log(JSON.stringify(person, null, 2))
      return
    }
    yield* printPerson(person)
  })
).pipe(Command.withDescription("Show a person with contacts and conversations"))

const merge = Command.make(
  "merge",
  {
    into: Argument.String("into").pipe(Argument.withDescription("Person that stays")),
    from: Argument.String("from").pipe(
      Argument.withDescription("Person whose contacts and conversations move to `into`")
    ),
    json
  },
  Effect.fn(function*({ into, from, json }) {
    const api = yield* Api
    const person = yield* api.PersonMerge({
      into: yield* resolvePerson(into),
      from: yield* resolvePerson(from)
    })
    if (json) {
      yield* Console.log(JSON.stringify(person, null, 2))
      return
    }
    yield* Console.log(`merged into ${person.id}`)
    yield* printPerson(person)
  })
).pipe(Command.withDescription("Merge one person into another"))

const split = Command.make(
  "split",
  {
    contact: Argument.String("contact").pipe(Argument.withDescription("Contact id or id prefix")),
    json
  },
  Effect.fn(function*({ contact, json }) {
    const api = yield* Api
    const person = yield* api.PersonSplit({ contactId: yield* resolveContact(contact) })
    if (json) {
      yield* Console.log(JSON.stringify(person, null, 2))
      return
    }
    yield* Console.log(`split into new person ${person.id}`)
  })
).pipe(Command.withDescription("Detach a contact into a new person"))

const relink = Command.make(
  "relink",
  {
    conversation: Flag.String("conversation").pipe(
      Flag.withDescription("Only this conversation id (full)"),
      Flag.optional
    ),
    json
  },
  Effect.fn(function*({ conversation, json }) {
    const api = yield* Api
    const result = yield* api.PeopleRelink({
      conversationId: Option.getOrUndefined(conversation) as never
    })
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    yield* Console.log(
      `conversations ${result.conversations}, people created ${result.peopleCreated}, ` +
        `contacts linked ${result.contactsLinked}, vacancy links ${result.vacancyLinks}, ` +
        `resume links ${result.resumeLinks}`
    )
    for (const suggestion of result.mergeSuggestions) {
      yield* Console.log(
        `suggest merge ${shortId(suggestion.a)} + ${shortId(suggestion.b)}: ${suggestion.reason}`
      )
    }
  })
).pipe(Command.withDescription("Re-run person linking for all conversations"))

const confirm = Command.make(
  "confirm",
  {
    contact: Argument.String("contact").pipe(Argument.withDescription("Contact id or id prefix"))
  },
  Effect.fn(function*({ contact }) {
    const api = yield* Api
    const result = yield* api.ContactConfirm({ contactId: yield* resolveContact(contact) })
    yield* Console.log(`confirmed ${result.id} -> ${result.personId ?? "-"}`)
  })
).pipe(Command.withDescription("Confirm a suggested contact-to-person link"))

const reject = Command.make(
  "reject",
  {
    contact: Argument.String("contact").pipe(Argument.withDescription("Contact id or id prefix"))
  },
  Effect.fn(function*({ contact }) {
    const api = yield* Api
    const result = yield* api.ContactReject({ contactId: yield* resolveContact(contact) })
    yield* Console.log(`rejected ${result.id}`)
  })
).pipe(Command.withDescription("Reject a suggested contact-to-person link"))

export const peopleCommand = Command.make("people").pipe(
  Command.withSubcommands([list, show, merge, split, relink, confirm, reject]),
  Command.withDescription("People: recruiters and managers behind contacts and conversations")
)
