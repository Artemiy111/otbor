import type {
  ApiError,
  ContactId,
  ContactRecord,
  PeopleRelinkResult,
  PersonMergeSuggestion,
  PersonRecord,
  PersonSummary
} from "@otbor/contract"
import { Conflict, NotFound } from "@otbor/contract"
import {
  attributeCandidates,
  excludeOwn,
  extractContactsFromText,
  normalizeIdentity,
  type OwnIdentities,
  rankResumeLinks,
  rankVacancyLinks,
  resolvePerson,
  type VacancyLinkSignal
} from "@otbor/domain"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor, type RepoEffect } from "../db/Database.ts"
import * as ContactRepository from "../repositories/ContactRepository.ts"
import * as ConversationRepository from "../repositories/ConversationRepository.ts"
import * as PersonRepository from "../repositories/PersonRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface PersonServiceShape {
  readonly list: (filter: PersonRepository.PersonFilter) => Effect.Effect<
    { readonly items: ReadonlyArray<PersonSummary>; readonly total: number },
    ApiError
  >
  readonly get: (id: string) => Effect.Effect<PersonRecord, ApiError>
  readonly update: (
    id: string,
    input: PersonRepository.UpdatePersonInput
  ) => Effect.Effect<PersonRecord, ApiError>
  readonly merge: (into: string, from: string) => Effect.Effect<PersonRecord, ApiError>
  readonly split: (contactId: string) => Effect.Effect<PersonRecord, ApiError>
  readonly confirm: (contactId: string) => Effect.Effect<ContactRecord, ApiError>
  readonly reject: (contactId: string) => Effect.Effect<ContactRecord, ApiError>
  /**
   * Перезапускает привязку: сообщения -> кандидаты -> человек, затем связи с
   * вакансиями и резюме. Без `conversationId` обходит все диалоги пользователя.
   * Пользователь передаётся явно: синхронизации работают вне запроса.
   */
  readonly relink: (
    userId: string,
    conversationId?: string
  ) => Effect.Effect<PeopleRelinkResult, ApiError>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

const CONTACT_SOURCE = {
  telegram: "telegram",
  mail: "mail",
  hh_chat: "hh_chat"
} as const

const telegramUsernameOf = (url: string | null): string | null => {
  if (url === null) return null
  const match = /(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})/iu.exec(url)
  return match?.[1] ?? null
}

/**
 * Привязывает к человеку один диалог. Возвращает счётчики и предложения слияния;
 * ничего не сливает сам.
 */
const linkConversation = (
  tx: Executor,
  userId: string,
  conversation: ConversationRepository.LinkingConversation,
  own: OwnIdentities
): RepoEffect<{
  readonly peopleCreated: number
  readonly contactsLinked: number
  readonly vacancyLinks: number
  readonly resumeLinks: number
  readonly mergeSuggestions: ReadonlyArray<PersonMergeSuggestion>
}> =>
  Effect.gen(function*() {
    const stored = yield* ConversationRepository.messages(tx, conversation.id, 500)
    const messages = stored.map((message) => ({ direction: message.direction, text: message.text }))

    // Кто собеседник по самому диалогу: id и username в Telegram, адрес в почте.
    const channel =
      conversation.channel === "telegram"
        ? ("telegram" as const)
        : conversation.channel === "mail"
          ? ("mail" as const)
          : ("hh" as const)
    let counterpartyEmail: string | null = null
    if (conversation.channel === "mail") {
      const senders = yield* ConversationRepository.mailSenders(tx, conversation.id)
      counterpartyEmail =
        excludeOwn(
          senders.map((value) => ({ kind: "email", value })),
          own
        )[0]?.value ?? null
    }

    const candidates = excludeOwn(
      attributeCandidates(messages, {
        channel,
        counterpartyName: conversation.personName,
        counterpartyUsername:
          conversation.channel === "telegram" ? telegramUsernameOf(conversation.url) : null,
        counterpartyTelegramId:
          conversation.channel === "telegram" && /^\d+$/.test(conversation.externalId)
            ? conversation.externalId
            : null,
        counterpartyEmail
      }),
      own
    )

    const existing = yield* PersonRepository.contactsByKeys(tx, userId, candidates)
    const resolution = resolvePerson({ identities: candidates, existing })

    // --- человек и контакты ------------------------------------------------
    let personId = conversation.personId
    let peopleCreated = 0
    if (resolution.action === "create") {
      const named = candidates.find((candidate) => candidate.personName !== null)
      const roled = candidates.find((candidate) => candidate.personRole !== null)
      personId = yield* PersonRepository.create(tx, {
        userId,
        displayName: conversation.personName ?? named?.personName ?? null,
        role: roled?.personRole ?? null
      })
      peopleCreated = 1
    } else if (resolution.action === "attach" && resolution.personId !== undefined) {
      personId = resolution.personId
      yield* PersonRepository.fillMissing(tx, userId, personId, {
        name: conversation.personName ?? candidates.find((item) => item.personName)?.personName,
        role: candidates.find((item) => item.personRole)?.personRole
      })
    }

    let contactsLinked = 0
    if (resolution.action !== "none" && personId !== null) {
      if (conversation.personId !== personId) {
        yield* ConversationRepository.setPerson(tx, userId, conversation.id, personId)
      }
      const byKey = new Map<string, (typeof candidates)[number]>(
        candidates.map((candidate) => [`${candidate.kind}:${candidate.value}`, candidate])
      )
      for (const personLink of ["auto", "suggested"] as const) {
        const contacts = resolution.identityLinks
          .filter((link) => link.personLink === personLink)
          .flatMap((link) => {
            const candidate = byKey.get(`${link.kind}:${normalizeIdentity(link.kind, link.value)}`)
            return candidate === undefined
              ? []
              : [
                  {
                    kind: candidate.kind,
                    value: candidate.value,
                    raw: candidate.raw,
                    url: candidate.url,
                    evidence: candidate.evidence,
                    confidence: candidate.confidence,
                    personName: candidate.personName,
                    personRole: candidate.personRole,
                    personId,
                    personLink
                  }
                ]
          })
        if (contacts.length === 0) continue
        yield* ContactRepository.upsertMany(tx, {
          userId,
          contacts,
          source: CONTACT_SOURCE[conversation.channel]
        })
        contactsLinked += contacts.length
      }
    }

    // --- вакансии ----------------------------------------------------------
    const textIds = new Set<string>()
    for (const message of messages) {
      if (message.text === null) continue
      for (const id of extractContactsFromText(message.text).vacancyIds) textIds.add(id)
    }
    const refs = yield* ConversationRepository.listVacancyRefs(tx, userId, conversation.id)
    const external = new Set([...textIds, ...refs.map((ref) => ref.externalId)])
    const resolved = yield* ConversationRepository.vacancyIdsByExternal(tx, "hh", [...external])

    const signals: Array<VacancyLinkSignal> = []
    for (const vacancyId of yield* ConversationRepository.hhChatVacancyIds(tx, conversation.id)) {
      signals.push({ vacancyId, kind: "hh_chat" })
    }
    for (const externalId of external) {
      const vacancyId = resolved.get(externalId)
      if (vacancyId !== undefined) {
        signals.push({ vacancyId, kind: "url_in_text" })
        continue
      }
      yield* ConversationRepository.addVacancyRef(tx, {
        userId,
        conversationId: conversation.id,
        externalId,
        evidence: null
      })
    }
    yield* ConversationRepository.deleteVacancyRefs(tx, conversation.id, [...resolved.keys()])

    const counterpartyKeys = new Set(
      candidates
        .filter((candidate) => candidate.attribution === "counterparty")
        .map((candidate) => `${candidate.kind}:${candidate.value}`)
    )
    for (const contact of existing) {
      if (
        contact.vacancyId !== null &&
        counterpartyKeys.has(`${contact.kind}:${normalizeIdentity(contact.kind, contact.value)}`)
      ) {
        signals.push({ vacancyId: contact.vacancyId, kind: "contact_in_vacancy" })
      }
    }
    if (personId !== null) {
      const inferred = yield* PersonRepository.vacancyIdsOfPerson(
        tx,
        userId,
        personId,
        conversation.id
      )
      for (const vacancyId of inferred) signals.push({ vacancyId, kind: "person_inference" })
    }

    const vacancies = rankVacancyLinks(signals)
    yield* ConversationRepository.clearInferredVacancies(tx, conversation.id)
    let vacancyLinks = 0
    for (const link of vacancies) {
      // Связь из чата hh уже записана ChatSync и здесь не дублируется.
      if (link.source === "hh_chat") continue
      const inserted = yield* ConversationRepository.linkVacancy(tx, {
        userId,
        conversationId: conversation.id,
        vacancyId: link.vacancyId,
        kind: link.kind,
        confidence: link.confidence,
        source: link.source
      })
      if (inserted) vacancyLinks += 1
    }

    // --- резюме ------------------------------------------------------------
    // Резюме чата hh точно знает отклик (`application.hh_chat_id`); id резюме из
    // самого чата — запасной путь, если отклик ещё не синхронизирован.
    let hhChatResumeId: string | null = null
    if (conversation.channel === "hh_chat") {
      if (UUID.test(conversation.accountId)) {
        hhChatResumeId = yield* PersonRepository.resumeIdByHhChat(
          tx,
          userId,
          conversation.accountId,
          conversation.externalId
        )
      }
      if (hhChatResumeId === null && typeof conversation.raw.resumeExternalId === "string") {
        hhChatResumeId = yield* PersonRepository.resumeIdByExternal(
          tx,
          userId,
          conversation.raw.resumeExternalId
        )
      }
    }
    const accountIds =
      conversation.channel === "telegram" && UUID.test(conversation.accountId)
        ? yield* PersonRepository.hhAccountsOfTelegram(tx, userId, conversation.accountId)
        : conversation.channel === "hh_chat" && UUID.test(conversation.accountId)
          ? [conversation.accountId]
          : []
    const vacancyIds = vacancies
      .filter((link) => link.kind !== "candidate")
      .map((link) => link.vacancyId)
    const applications = yield* PersonRepository.applicationsOnVacancies(tx, userId, vacancyIds)
    const accountResumes = yield* PersonRepository.resumesOfAccounts(tx, userId, accountIds)

    const resumes = rankResumeLinks({
      vacancyApplications: applications,
      vacancyIds,
      telegramHhAccountIds: accountIds,
      accountResumes,
      hhChatResumeId
    })
    yield* ConversationRepository.clearInferredResumes(tx, conversation.id)
    for (const resume of resumes) {
      yield* ConversationRepository.linkResume(tx, {
        userId,
        conversationId: conversation.id,
        resumeId: resume.resumeId,
        confidence: resume.confidence,
        source: resume.source
      })
    }

    return {
      peopleCreated,
      contactsLinked,
      vacancyLinks,
      resumeLinks: resumes.length,
      mergeSuggestions: resolution.mergeSuggestions.map((item) => ({
        a: item.a as PersonMergeSuggestion["a"],
        b: item.b as PersonMergeSuggestion["b"],
        reason: item.reason
      }))
    }
  })

/**
 * Перелинковка внутри уже открытой транзакции: её же вызывают синхронизации
 * после записи сообщений, не открывая вторую.
 */
export const relinkConversations = (
  tx: Executor,
  userId: string,
  conversationId?: string
): RepoEffect<PeopleRelinkResult> =>
  Effect.gen(function*() {
    yield* PersonRepository.autoLinkTelegramAccounts(tx, userId)
    const own = yield* PersonRepository.ownIdentities(tx, userId)
    const conversations = yield* ConversationRepository.listForLinking(tx, userId, conversationId)

    let peopleCreated = 0
    let contactsLinked = 0
    let vacancyLinks = 0
    let resumeLinks = 0
    const suggestions = new Map<string, PersonMergeSuggestion>()

    for (const conversation of conversations) {
      const result = yield* linkConversation(tx, userId, conversation, own)
      peopleCreated += result.peopleCreated
      contactsLinked += result.contactsLinked
      vacancyLinks += result.vacancyLinks
      resumeLinks += result.resumeLinks
      for (const item of result.mergeSuggestions) suggestions.set(`${item.a}:${item.b}`, item)
    }

    return {
      conversations: conversations.length,
      peopleCreated,
      contactsLinked,
      vacancyLinks,
      resumeLinks,
      mergeSuggestions: [...suggestions.values()]
    }
  })

/** Люди: чтение и правки идут от имени пользователя, перелинковка — по явному `userId`. */
export class PersonService extends Context.Service<PersonService, PersonServiceShape>()(
  "otbor/cloud/PersonService"
) {
  static readonly layer = Layer.effect(
    PersonService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const userId = currentUser.userId

      const getRecord = (operation: string, id: string) =>
        database.asUser(userId, (tx) => PersonRepository.get(tx, userId, id)).pipe(
          Effect.mapError(toStorageError(operation)),
          Effect.flatMap((record) =>
            record === null ? Effect.fail(new NotFound({ entity: "Person", id })) : Effect.succeed(record)
          )
        )

      const list: PersonServiceShape["list"] = Effect.fn("PersonService.list")(function*(filter) {
        return yield* database
          .asUser(userId, (tx) => PersonRepository.list(tx, userId, filter))
          .pipe(Effect.mapError(toStorageError("person.list")))
      })

      const get: PersonServiceShape["get"] = Effect.fn("PersonService.get")(function*(id) {
        return yield* getRecord("person.get", id)
      })

      const update: PersonServiceShape["update"] = Effect.fn("PersonService.update")(
        function*(id, input) {
          const updated = yield* database
            .asUser(userId, (tx) => PersonRepository.update(tx, userId, id, input))
            .pipe(Effect.mapError(toStorageError("person.update")))
          if (!updated) return yield* new NotFound({ entity: "Person", id })
          return yield* getRecord("person.update", id)
        }
      )

      const merge: PersonServiceShape["merge"] = Effect.fn("PersonService.merge")(
        function*(into, from) {
          const merged = yield* database
            .asUser(userId, (tx) => PersonRepository.merge(tx, userId, { into, from }))
            .pipe(Effect.mapError(toStorageError("person.merge")))
          if (!merged) {
            return yield* new Conflict({
              entity: "Person",
              message: "Cannot merge: unknown person, the same person or one is already merged"
            })
          }
          return yield* getRecord("person.merge", into)
        }
      )

      const split: PersonServiceShape["split"] = Effect.fn("PersonService.split")(
        function*(contactId) {
          const personId = yield* database
            .asUser(userId, (tx) => PersonRepository.split(tx, userId, contactId))
            .pipe(Effect.mapError(toStorageError("person.split")))
          if (personId === null) return yield* new NotFound({ entity: "Contact", id: contactId })
          return yield* getRecord("person.split", personId)
        }
      )

      /** Подтверждение и отклонение идемпотентны: итог всегда читается из базы. */
      const decide = (
        operation: string,
        write: (tx: Executor, contactId: string) => RepoEffect<boolean>
      ) =>
        Effect.fn(operation)(function*(contactId: string) {
          const record = yield* database
            .asUser(userId, (tx) =>
              Effect.gen(function*() {
                yield* write(tx, contactId)
                return yield* ContactRepository.findById(tx, userId, contactId)
              })
            )
            .pipe(Effect.mapError(toStorageError(operation)))
          if (record === null) {
            return yield* new NotFound({ entity: "Contact", id: contactId as ContactId })
          }
          return record
        })

      const confirm: PersonServiceShape["confirm"] = decide("person.confirm", (tx, contactId) =>
        PersonRepository.confirmContact(tx, userId, contactId)
      )
      const reject: PersonServiceShape["reject"] = decide("person.reject", (tx, contactId) =>
        PersonRepository.rejectContact(tx, userId, contactId)
      )

      const relink: PersonServiceShape["relink"] = Effect.fn("PersonService.relink")(
        function*(forUser, conversationId) {
          return yield* database
            .asUser(forUser, (tx) => relinkConversations(tx, forUser, conversationId))
            .pipe(Effect.mapError(toStorageError("person.relink")))
        }
      )

      return PersonService.of({ list, get, update, merge, split, confirm, reject, relink })
    })
  )
}
