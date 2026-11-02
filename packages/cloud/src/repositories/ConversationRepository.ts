import type {
  ConversationChannel,
  ConversationDetail,
  ConversationMessageRecord,
  ConversationSummary,
  MessageDirection,
  MessageKind,
  VacancyId
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/**
 * One conversation row per thread. `external_id` is whatever the channel calls
 * a thread: an RFC thread key, a Telegram chat id, or an hh chat id.
 */

export interface StoredConversation {
  readonly id: string
  readonly user_id: string
  readonly channel: string
  readonly account_id: string
  readonly external_id: string
  readonly title: string | null
  readonly url: string | null
  readonly person_name: string | null
  readonly person_role: string | null
  readonly last_message_at: Date | string | null
  readonly unread_count: number
  readonly archived: boolean
  readonly last_message: string | null
  readonly vacancy_id: string | null
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toSummary = (row: StoredConversation): ConversationSummary => ({
  id: row.id as ConversationSummary["id"],
  channel: row.channel as ConversationChannel,
  accountId: row.account_id,
  externalId: row.external_id,
  title: row.title,
  url: row.url,
  personName: row.person_name,
  personRole: row.person_role,
  lastMessageAt: iso(row.last_message_at),
  unreadCount: Number(row.unread_count),
  archived: row.archived,
  lastMessage: row.last_message,
  vacancyId: row.vacancy_id as VacancyId | null
})

const selection = sql`
  select c.id, c.user_id, c.channel, c.account_id, c.external_id, c.title, c.url,
         c.person_name, c.person_role, c.last_message_at, c.unread_count, c.archived,
         (
           select m.text from conversation_message m
           where m.conversation_id = c.id
           order by m.sent_at desc, m.id desc
           limit 1
         ) as last_message,
         (
           select cv.vacancy_id from conversation_vacancy cv
           where cv.conversation_id = c.id
           order by (cv.kind = 'primary') desc, cv.created_at
           limit 1
         ) as vacancy_id
  from conversation c
`

export interface ConversationFilter {
  readonly channel?: ConversationChannel
  readonly query?: string
  readonly limit?: number
  readonly accountId?: string
}

export const list = (
  tx: Executor,
  userId: string,
  filter: ConversationFilter = {}
): RepoEffect<ReadonlyArray<ConversationSummary>> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
    const query = filter.query?.trim() ?? ""
    const pattern = query === "" ? null : `%${query.replace(/[%_\\]/g, "\\$&")}%`

    const conditions = [sql`c.user_id = ${userId}`]
    if (filter.channel !== undefined) conditions.push(sql`c.channel = ${filter.channel}`)
    if (filter.accountId !== undefined) {
      conditions.push(sql`c.account_id = ${filter.accountId}`)
    }
    if (pattern !== null) {
      conditions.push(
        sql`(c.title ilike ${pattern} or c.person_name ilike ${pattern} or c.external_id ilike ${pattern})`
      )
    }

    const rows = yield* tx.execute(sql`
      ${selection}
      where ${sql.join(conditions, sql` and `)}
      order by c.last_message_at desc nulls last, c.id
      limit ${limit}
    `)

    return (rows.rows as unknown as ReadonlyArray<StoredConversation>).map(toSummary)
  })

const messageSelection = sql`
  select id, external_id, direction, sent_at, kind, text, read_at
  from conversation_message
`

interface StoredMessage {
  readonly id: string
  readonly external_id: string
  readonly direction: string
  readonly sent_at: Date | string
  readonly kind: string
  readonly text: string | null
  readonly read_at: Date | string | null
}

const toMessage = (row: StoredMessage): ConversationMessageRecord => ({
  id: row.id,
  externalId: row.external_id,
  direction: row.direction as MessageDirection,
  sentAt: iso(row.sent_at)!,
  kind: row.kind as MessageKind,
  text: row.text,
  readAt: iso(row.read_at)
})

export const messages = (
  tx: Executor,
  conversationId: string,
  limit = 200
): RepoEffect<ReadonlyArray<ConversationMessageRecord>> =>
  tx
    .execute(sql`
      ${messageSelection}
      where conversation_id = ${conversationId}
      order by sent_at asc, id asc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<StoredMessage>).map(toMessage)
      )
    )

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<ConversationSummary | null> =>
  tx
    .execute(sql`
      ${selection}
      where c.user_id = ${userId} and c.id = ${id}
      limit 1
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as StoredConversation | undefined
        return row === undefined ? null : toSummary(row)
      })
    )

export const get = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<ConversationDetail | null> =>
  Effect.gen(function*() {
    const conversation = yield* find(tx, userId, id)
    if (conversation === null) return null
    const rows = yield* messages(tx, id)
    return { conversation, messages: rows }
  })

export const findByExternal = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly channel: ConversationChannel
    readonly accountId: string
    readonly externalId: string
  }
): RepoEffect<string | null> =>
  tx
    .execute(sql`
      select id from conversation
      where user_id = ${input.userId}
        and channel = ${input.channel}
        and account_id = ${input.accountId}
        and external_id = ${input.externalId}
      limit 1
    `)
    .pipe(
      Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null)
    )

export interface UpsertConversationInput {
  readonly userId: string
  readonly channel: ConversationChannel
  readonly accountId: string
  readonly externalId: string
  readonly title?: string | null
  readonly url?: string | null
  readonly personName?: string | null
  readonly personRole?: string | null
  readonly lastMessageAt?: Date | null
  readonly unreadCount?: number
  readonly archived?: boolean
  readonly raw?: Record<string, unknown>
}

/**
 * Finds or creates the thread. Title and url only move forward: a later sync
 * with no subject must not erase the one the first message carried.
 */
export const upsert = (
  tx: Executor,
  input: UpsertConversationInput
): RepoEffect<string> =>
  Effect.gen(function*() {
    const existing = yield* findByExternal(tx, input)
    if (existing !== null) {
      yield* tx.execute(sql`
        update conversation set
          title = coalesce(${input.title ?? null}, title),
          url = coalesce(${input.url ?? null}, url),
          person_name = coalesce(${input.personName ?? null}, person_name),
          person_role = coalesce(${input.personRole ?? null}, person_role),
          last_message_at = greatest(
            coalesce(${input.lastMessageAt ?? null}, last_message_at),
            last_message_at
          ),
          unread_count = ${Math.max(0, Math.trunc(input.unreadCount ?? 0))},
          archived = ${input.archived ?? false},
          raw = ${JSON.stringify(input.raw ?? {})}::jsonb,
          updated_at = now()
        where id = ${existing}
      `)
      return existing
    }

    const result = yield* tx.execute(sql`
      insert into conversation (
        user_id, channel, account_id, external_id, title, url, person_name,
        person_role, last_message_at, unread_count, archived, raw
      ) values (
        ${input.userId}, ${input.channel}, ${input.accountId}, ${input.externalId},
        ${input.title ?? null}, ${input.url ?? null}, ${input.personName ?? null},
        ${input.personRole ?? null}, ${input.lastMessageAt ?? null},
        ${Math.max(0, Math.trunc(input.unreadCount ?? 0))},
        ${input.archived ?? false}, ${JSON.stringify(input.raw ?? {})}::jsonb
      )
      returning id
    `)
    return (result.rows[0] as { id: string }).id
  })

export interface MessageInput {
  readonly externalId: string
  readonly direction: MessageDirection
  readonly sentAt: Date
  readonly kind?: MessageKind
  readonly text?: string | null
  readonly readAt?: Date | null
}

/**
 * Idempotent by `(conversation_id, external_id)`. Read state only moves
 * forward: a source that temporarily loses its watermark cannot unread a
 * message that was already read.
 */
export const appendMessages = (
  tx: Executor,
  userId: string,
  conversationId: string,
  inputs: ReadonlyArray<MessageInput>
): RepoEffect<{ readonly inserted: number; readonly updated: number }> =>
  Effect.gen(function*() {
    let inserted = 0
    let updated = 0

    for (const message of inputs) {
      const result = yield* tx.execute(sql`
        insert into conversation_message (
          user_id, conversation_id, external_id, direction, sent_at, kind, text, read_at
        ) values (
          ${userId}, ${conversationId}, ${message.externalId}, ${message.direction},
          ${message.sentAt}, ${message.kind ?? "text"}, ${message.text ?? null},
          ${message.readAt ?? null}
        )
        on conflict (conversation_id, external_id) do update set
          direction = excluded.direction,
          sent_at = excluded.sent_at,
          kind = excluded.kind,
          text = coalesce(excluded.text, conversation_message.text),
          read_at = coalesce(conversation_message.read_at, excluded.read_at)
        returning (xmax = 0) as inserted
      `)
      const row = result.rows[0] as { inserted?: boolean } | undefined
      if (row?.inserted === true) inserted += 1
      else updated += 1
    }

    if (inputs.length > 0) {
      const latest = inputs.reduce((left, right) =>
        right.sentAt.getTime() > left.sentAt.getTime() ? right : left
      )
      yield* tx.execute(sql`
        update conversation set
          last_message_at = greatest(coalesce(last_message_at, ${latest.sentAt}), ${latest.sentAt}),
          updated_at = now()
        where id = ${conversationId}
      `)
    }

    return { inserted, updated }
  })

export const setUnread = (
  tx: Executor,
  conversationId: string,
  unreadCount: number
): RepoEffect<void> =>
  tx
    .execute(sql`
      update conversation set unread_count = ${Math.max(0, Math.trunc(unreadCount))}
      where id = ${conversationId}
    `)
    .pipe(Effect.asVoid)

export interface LinkVacancyInput {
  readonly userId: string
  readonly conversationId: string
  readonly vacancyId: string
  readonly kind?: "primary" | "mentioned" | string
  readonly confidence?: number | null
  readonly source?: string
  readonly evidence?: string | null
}

export const linkVacancy = (
  tx: Executor,
  input: LinkVacancyInput
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      insert into conversation_vacancy (
        user_id, conversation_id, vacancy_id, kind, confidence, source, evidence
      ) values (
        ${input.userId}, ${input.conversationId}, ${input.vacancyId},
        ${input.kind ?? "primary"}, ${input.confidence ?? 1},
        ${input.source ?? "chat"}, ${input.evidence ?? null}
      )
      on conflict (conversation_id, vacancy_id, kind) do nothing
      returning conversation_id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export const hasPrimaryVacancy = (
  tx: Executor,
  conversationId: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      select 1 from conversation_vacancy
      where conversation_id = ${conversationId} and kind = 'primary'
      limit 1
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** The conversation of a stored message with this RFC id, for thread stitching. */
export const conversationForMessage = (
  tx: Executor,
  accountId: string,
  rfcMessageIds: ReadonlyArray<string>
): RepoEffect<string | null> => {
  const ids = rfcMessageIds.map((id) => id.trim()).filter((id) => id !== "")
  if (ids.length === 0) return Effect.succeed(null)
  const placeholders = sql.join(ids.map((id) => sql`${id}`), sql`, `)

  return tx
    .execute(sql`
      select conversation_id from mail_message
      where account_id = ${accountId}
        and rfc_message_id in (${placeholders})
        and conversation_id is not null
      order by received_at desc nulls last
      limit 1
    `)
    .pipe(
      Effect.map(
        (result) =>
          (result.rows[0] as { conversation_id?: string | null } | undefined)?.conversation_id ??
          null
      )
    )
}
