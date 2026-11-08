import { eq } from "drizzle-orm"
import { Effect } from "effect"
import {
  contact,
  conversation,
  conversationMessage,
  conversationVacancy,
  conversationVacancyRef,
  person
} from "../../../src/db/tables.ts"
import { PersonService } from "../../../src/services/PersonService.ts"
import { runAs } from "./layers.ts"
import { ownerTx } from "./seeds.ts"

export interface SeedMessage {
  readonly direction: "in" | "out"
  readonly text: string
}

/** Кладёт диалог с сообщениями напрямую, как это сделала бы синхронизация. */
export const seedConversation = async (
  userId: string,
  input: {
    readonly channel: "telegram" | "mail" | "hh_chat"
    readonly externalId: string
    readonly accountId?: string
    readonly url?: string | null
    readonly personName?: string | null
    readonly messages: ReadonlyArray<SeedMessage>
  }
): Promise<string> =>
  runAs(
    "owner",
    ownerTx((tx) =>
      Effect.gen(function*() {
        const [row] = yield* tx
          .insert(conversation)
          .values({
            userId,
            channel: input.channel,
            accountId: input.accountId ?? "",
            externalId: input.externalId,
            url: input.url ?? null,
            personName: input.personName ?? null
          })
          .returning()
        let index = 0
        for (const message of input.messages) {
          index += 1
          yield* tx.insert(conversationMessage).values({
            userId,
            conversationId: row!.id,
            externalId: `m${index}`,
            direction: message.direction,
            sentAt: new Date(Date.UTC(2026, 0, 1, 12, index)),
            text: message.text
          })
        }
        return row!.id
      })
    )
  )

export const relink = (userId: string, conversationId?: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.relink(userId, conversationId)
    })
  )

export const personList = (userId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.list({})
    })
  )

export const personGet = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.get(id)
    })
  )

export const personMerge = (userId: string, into: string, from: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.merge(into, from)
    })
  )

export const personSplit = (userId: string, contactId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.split(contactId)
    })
  )

export const contactConfirm = (userId: string, contactId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.confirm(contactId)
    })
  )

export const contactReject = (userId: string, contactId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const people = yield* PersonService
      return yield* people.reject(contactId)
    })
  )

export const personRowsFor = async (userId: string) =>
  runAs("owner", ownerTx((tx) => tx.select().from(person).where(eq(person.userId, userId))))

export const contactRowsOf = async (userId: string) =>
  runAs("owner", ownerTx((tx) => tx.select().from(contact).where(eq(contact.userId, userId))))

export const conversationRowOf = async (id: string) =>
  runAs(
    "owner",
    ownerTx((tx) => tx.select().from(conversation).where(eq(conversation.id, id)))
  ).then((rows) => rows[0]!)

export const vacancyRefsOf = async (conversationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(conversationVacancyRef)
        .where(eq(conversationVacancyRef.conversationId, conversationId))
    )
  )

export const linkedVacanciesOf = async (conversationId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx
        .select()
        .from(conversationVacancy)
        .where(eq(conversationVacancy.conversationId, conversationId))
    )
  )
