import type {
  ConversationChannel,
  ConversationDetail,
  ConversationListItem,
  ConversationMessageRecord,
  ConversationSummary,
  MessageDirection,
  MessageKind,
  PersonId,
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
  readonly person_id: string | null
  readonly vacancy_title?: string | null
  readonly employer_name?: string | null
  readonly hh_account_id?: string | null
  readonly read_at?: Date | string | null
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toSummary = (row: StoredConversation): ConversationListItem => ({
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
  vacancyId: row.vacancy_id as VacancyId | null,
  personId: row.person_id as PersonId | null,
  vacancyTitle: row.vacancy_title ?? null,
  employerName: row.employer_name ?? null,
  hhAccountId: row.hh_account_id ?? null,
  readAt: iso(row.read_at ?? null)
})

/**
 * Сколько входящих сообщений диалога непрочитано, по правилу otbor.
 *
 * - `read_at` задан (оператор открывал диалог): входящие новее `read_at`.
 *   Значение, которое записал синк (`unread_count`), игнорируется, поэтому
 *   прочитанный диалог остаётся прочитанным, пока не придёт новое входящее.
 * - `read_at` нет, Telegram: счётчик источника `unread_count`.
 * - `read_at` нет, почта и чат hh: входящие без `read_at` у самого сообщения.
 * Ручная отметка `marked_unread` даёт минимум 1. Алиас таблицы - `c`.
 * Это подзапросы по индексу `(conversation_id, sent_at)`, а не сканирование.
 */
export const unreadExpr = sql`(greatest(
  case
    when c.read_at is not null then (
      select count(*) from conversation_message m
      where m.conversation_id = c.id and m.direction = 'in' and m.sent_at > c.read_at
    )
    when c.channel = 'telegram' then c.unread_count
    else (
      select count(*) from conversation_message m
      where m.conversation_id = c.id and m.direction = 'in' and m.read_at is null
    )
  end,
  case when c.marked_unread then 1 else 0 end
))::int`

const selection = sql`
  select c.id, c.user_id, c.channel, c.account_id, c.external_id, c.title, c.url,
         c.person_name, c.person_role, c.last_message_at, ${unreadExpr} as unread_count,
         c.archived, c.person_id, c.read_at,
         v.title as vacancy_title, e.name as employer_name,
         case when c.channel = 'hh_chat' then c.account_id end as hh_account_id,
         (
           select m.text from conversation_message m
           where m.conversation_id = c.id
           order by m.sent_at desc, m.id desc
           limit 1
         ) as last_message,
         cvx.vacancy_id as vacancy_id
  from conversation c
  left join lateral (
    select cv.vacancy_id from conversation_vacancy cv
    where cv.conversation_id = c.id
    order by (cv.kind = 'primary') desc, cv.created_at
    limit 1
  ) cvx on true
  left join vacancy v on v.id = cvx.vacancy_id
  left join employer e on e.id = v.employer_id
`

export interface ConversationFilter {
  readonly channel?: ConversationChannel
  readonly query?: string
  readonly limit?: number
  readonly accountId?: string
  readonly personId?: string
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
    if (filter.personId !== undefined) {
      conditions.push(sql`c.person_id = ${filter.personId}`)
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

export interface ConversationSearchFilter {
  readonly search?: string
  readonly channel?: ConversationChannel
  readonly unread?: boolean
  readonly archived?: boolean
  readonly accountId?: string
  readonly personId?: string
  readonly limit?: number
  readonly offset?: number
}

/**
 * Страница диалогов с итогами. Поиск `ilike` идёт по имени собеседника,
 * заголовку, внешнему id и тексту сообщений. Trigram-индекса нет, поэтому
 * поиск по тексту - это сканирование сообщений пользователя (по индексу
 * `conversation_id` на каждый диалог); без `search` оно не выполняется.
 * Фильтр `unread` считает непрочитанные выражением `unreadExpr` по каждому
 * диалогу пользователя, это тоже проход по его диалогам.
 */
export const search = (
  tx: Executor,
  userId: string,
  filter: ConversationSearchFilter = {}
): RepoEffect<{
  readonly items: ReadonlyArray<ConversationListItem>
  readonly total: number
  readonly unreadTotal: number
}> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
    const offset = Math.max(filter.offset ?? 0, 0)
    const term = filter.search?.trim() ?? ""
    const pattern = term === "" ? null : `%${term.replace(/[%_\\]/g, "\\$&")}%`

    const base = [sql`c.user_id = ${userId}`]
    if (filter.channel !== undefined) base.push(sql`c.channel = ${filter.channel}`)
    if (filter.archived !== undefined) base.push(sql`c.archived = ${filter.archived}`)
    if (filter.accountId !== undefined) base.push(sql`c.account_id = ${filter.accountId}`)
    if (filter.personId !== undefined) base.push(sql`c.person_id = ${filter.personId}`)
    if (pattern !== null) {
      base.push(sql`(
        c.title ilike ${pattern} or c.person_name ilike ${pattern}
        or c.external_id ilike ${pattern}
        or exists (
          select 1 from conversation_message sm
          where sm.conversation_id = c.id and sm.text ilike ${pattern}
        )
      )`)
    }
    const baseWhere = sql.join(base, sql` and `)
    const unreadOnly = filter.unread === true
    const pageWhere = unreadOnly ? sql`${baseWhere} and ${unreadExpr} > 0` : baseWhere

    const rows = yield* tx.execute(sql`
      ${selection}
      where ${pageWhere}
      order by c.last_message_at desc nulls last, c.id
      limit ${limit} offset ${offset}
    `)

    const totals = yield* tx.execute(sql`
      select count(*)::int as total,
             count(*) filter (where ${unreadExpr} > 0 and not c.archived)::int as unread_total
      from conversation c
      where ${baseWhere}
    `)
    const row = (totals.rows[0] ?? {}) as { total?: number; unread_total?: number }
    const unreadTotal = Number(row.unread_total ?? 0)
    const allTotal = Number(row.total ?? 0)

    // При фильтре `unread` total - это число непрочитанных, а не всех.
    let total = allTotal
    if (unreadOnly) {
      const counted = yield* tx.execute(sql`
        select count(*)::int as n from conversation c where ${pageWhere}
      `)
      total = Number((counted.rows[0] as { n?: number } | undefined)?.n ?? 0)
    }

    return {
      items: (rows.rows as unknown as ReadonlyArray<StoredConversation>).map(toSummary),
      total,
      unreadTotal
    }
  })

/**
 * Отмечает диалог прочитанным в otbor: `read_at` встаёт на последнее входящее
 * (или на now(), если входящих нет) и никогда не уходит назад. Источник не
 * трогаем. Возвращает `false`, если диалога нет у пользователя.
 */
export const markRead = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update conversation c set
        read_at = greatest(
          c.read_at,
          coalesce(
            (select max(m.sent_at) from conversation_message m
             where m.conversation_id = c.id and m.direction = 'in'),
            now()
          )
        ),
        marked_unread = false
      where c.user_id = ${userId} and c.id = ${id}
      returning c.id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Возвращает диалог в непрочитанные: ручная отметка, `read_at` не меняется. */
export const markUnread = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update conversation set marked_unread = true
      where user_id = ${userId} and id = ${id}
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

const messageSelection = sql`
  select m.id, m.external_id, m.direction, m.sent_at, m.kind, m.text, m.read_at,
         mm.from_json -> 0 ->> 'name' as sender_name,
         mm.from_json -> 0 ->> 'address' as sender_address
  from conversation_message m
  left join mail_message mm
    on mm.conversation_id = m.conversation_id and mm.rfc_message_id = m.external_id
`

interface StoredMessage {
  readonly id: string
  readonly external_id: string
  readonly direction: string
  readonly sent_at: Date | string
  readonly kind: string
  readonly text: string | null
  readonly read_at: Date | string | null
  readonly sender_name?: string | null
  readonly sender_address?: string | null
}

const toMessage = (row: StoredMessage): ConversationMessageRecord => ({
  id: row.id,
  externalId: row.external_id,
  direction: row.direction as MessageDirection,
  sentAt: iso(row.sent_at)!,
  kind: row.kind as MessageKind,
  text: row.text,
  readAt: iso(row.read_at),
  senderName: row.sender_name ?? null,
  senderAddress: row.sender_address ?? null
})

export const messages = (
  tx: Executor,
  conversationId: string,
  limit = 200
): RepoEffect<ReadonlyArray<ConversationMessageRecord>> =>
  tx
    .execute(sql`
      ${messageSelection}
      where m.conversation_id = ${conversationId}
      order by m.sent_at asc, m.id asc
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
): RepoEffect<ConversationListItem | null> =>
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
  const ids = rfcMessageIds.values().map((id) => id.trim()).filter((id) => id !== "").toArray()
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

/* -------------------------------------------------------------------------- */
/* Человек, резюме и ссылки на вакансии                                       */
/* -------------------------------------------------------------------------- */

/** Привязывает диалог к человеку (или снимает привязку при `null`). */
export const setPerson = (
  tx: Executor,
  userId: string,
  conversationId: string,
  personId: string | null
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update conversation set person_id = ${personId}
      where id = ${conversationId} and user_id = ${userId}
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface LinkResumeInput {
  readonly userId: string
  readonly conversationId: string
  readonly resumeId: string
  readonly confidence?: number | null
  readonly source?: string | null
  readonly evidence?: string | null
}

/** Идемпотентно: повторная связь повышает уверенность, но не понижает её. */
export const linkResume = (
  tx: Executor,
  input: LinkResumeInput
): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into conversation_resume (
        user_id, conversation_id, resume_id, confidence, source, evidence
      ) values (
        ${input.userId}, ${input.conversationId}, ${input.resumeId},
        ${input.confidence ?? null}, ${input.source ?? null}, ${input.evidence ?? null}
      )
      on conflict (conversation_id, resume_id) do update set
        confidence = greatest(
          coalesce(conversation_resume.confidence, 0),
          coalesce(excluded.confidence, 0)
        ),
        source = case
          when coalesce(excluded.confidence, 0) >= coalesce(conversation_resume.confidence, 0)
            then excluded.source
          else conversation_resume.source
        end,
        evidence = coalesce(excluded.evidence, conversation_resume.evidence)
    `)
    .pipe(Effect.asVoid)

/** Резюме диалога, выведенные автоматикой; ручные связи (`manual`) не трогаются. */
export const clearInferredResumes = (
  tx: Executor,
  conversationId: string
): RepoEffect<void> =>
  tx
    .execute(sql`
      delete from conversation_resume
      where conversation_id = ${conversationId}
        and coalesce(source, '') <> 'manual'
    `)
    .pipe(Effect.asVoid)

/** Источники связей диалога с вакансией, которыми владеет перелинковка. */
export const INFERRED_VACANCY_SOURCES = [
  "url_in_text",
  "contact_in_vacancy",
  "person_inference"
] as const

/** Снимает выведенные связи диалога с вакансиями; связь из чата hh остаётся. */
export const clearInferredVacancies = (
  tx: Executor,
  conversationId: string
): RepoEffect<void> =>
  tx
    .execute(sql`
      delete from conversation_vacancy
      where conversation_id = ${conversationId}
        and source in (${sql.join(
          INFERRED_VACANCY_SOURCES.map((source) => sql`${source}`),
          sql`, `
        )})
    `)
    .pipe(Effect.asVoid)

/** Вакансии диалога, подтверждённые чатом hh. */
export const hhChatVacancyIds = (
  tx: Executor,
  conversationId: string
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select vacancy_id::text as vacancy_id from conversation_vacancy
      where conversation_id = ${conversationId} and source = 'hh_chat'
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ vacancy_id: string }>).map(
          (row) => row.vacancy_id
        )
      )
    )

/** Идентификаторы вакансий hh из базы по их внешним id. */
export const vacancyIdsByExternal = (
  tx: Executor,
  source: string,
  externalIds: ReadonlyArray<string>
): RepoEffect<ReadonlyMap<string, string>> => {
  if (externalIds.length === 0) return Effect.succeed(new Map())
  return tx
    .execute(sql`
      select id::text as id, external_id from vacancy
      where source = ${source}
        and external_id in (${sql.join(externalIds.map((id) => sql`${id}`), sql`, `)})
    `)
    .pipe(
      Effect.map(
        (result) =>
          new Map(
            (result.rows as unknown as ReadonlyArray<{ id: string; external_id: string }>).map(
              (row) => [row.external_id, row.id] as const
            )
          )
      )
    )
}

export interface VacancyRefInput {
  readonly userId: string
  readonly conversationId: string
  readonly externalId: string
  readonly source?: string
  readonly evidence?: string | null
}

/** Запоминает ссылку на вакансию hh, которой ещё нет в базе. */
export const addVacancyRef = (
  tx: Executor,
  input: VacancyRefInput
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      insert into conversation_vacancy_ref (
        user_id, conversation_id, source, external_id, evidence
      ) values (
        ${input.userId}, ${input.conversationId}, ${input.source ?? "hh"},
        ${input.externalId}, ${input.evidence ?? null}
      )
      on conflict (conversation_id, external_id) do nothing
      returning conversation_id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface StoredVacancyRef {
  readonly conversationId: string
  readonly source: string
  readonly externalId: string
  readonly evidence: string | null
}

export const listVacancyRefs = (
  tx: Executor,
  userId: string,
  conversationId?: string
): RepoEffect<ReadonlyArray<StoredVacancyRef>> =>
  tx
    .execute(sql`
      select conversation_id::text as conversation_id, source, external_id, evidence
      from conversation_vacancy_ref
      where user_id = ${userId}
        ${conversationId === undefined ? sql`` : sql`and conversation_id = ${conversationId}`}
    `)
    .pipe(
      Effect.map((result) =>
        (
          result.rows as unknown as ReadonlyArray<{
            conversation_id: string
            source: string
            external_id: string
            evidence: string | null
          }>
        ).map((row) => ({
          conversationId: row.conversation_id,
          source: row.source,
          externalId: row.external_id,
          evidence: row.evidence
        }))
      )
    )

/**
 * Превращает ссылки, чьи вакансии уже появились в базе, в связи диалога
 * (`mentioned`, источник `url_in_text`) и удаляет разрешённые ссылки.
 * Возвращает число разрешённых. Главную вакансию определяет перелинковка.
 */
export const resolveVacancyRefs = (
  tx: Executor,
  userId: string,
  conversationId?: string
): RepoEffect<number> =>
  Effect.gen(function*() {
    const inserted = yield* tx.execute(sql`
      with resolved as (
        select r.user_id, r.conversation_id, r.source, r.external_id, r.evidence, v.id as vacancy_id
        from conversation_vacancy_ref r
        join vacancy v on v.source = r.source and v.external_id = r.external_id
        where r.user_id = ${userId}
          ${conversationId === undefined ? sql`` : sql`and r.conversation_id = ${conversationId}`}
      ), linked as (
        insert into conversation_vacancy (
          user_id, conversation_id, vacancy_id, kind, confidence, source, evidence
        )
        select user_id, conversation_id, vacancy_id, 'mentioned', 1, 'url_in_text', evidence
        from resolved
        on conflict (conversation_id, vacancy_id, kind) do nothing
      )
      delete from conversation_vacancy_ref r
      using resolved
      where r.conversation_id = resolved.conversation_id
        and r.external_id = resolved.external_id
      returning r.conversation_id
    `)
    return inserted.rows.length
  })

export const deleteVacancyRefs = (
  tx: Executor,
  conversationId: string,
  externalIds: ReadonlyArray<string>
): RepoEffect<void> => {
  if (externalIds.length === 0) return Effect.void
  return tx
    .execute(sql`
      delete from conversation_vacancy_ref
      where conversation_id = ${conversationId}
        and external_id in (${sql.join(externalIds.map((id) => sql`${id}`), sql`, `)})
    `)
    .pipe(Effect.asVoid)
}

/** Диалог в том виде, в каком его читает перелинковка. */
export interface LinkingConversation {
  readonly id: string
  readonly channel: ConversationChannel
  readonly accountId: string
  readonly externalId: string
  readonly url: string | null
  readonly personName: string | null
  readonly personId: string | null
  readonly raw: Record<string, unknown>
}

export const listForLinking = (
  tx: Executor,
  userId: string,
  conversationId?: string
): RepoEffect<ReadonlyArray<LinkingConversation>> =>
  tx
    .execute(sql`
      select id::text as id, channel, account_id, external_id, url, person_name,
             person_id::text as person_id, raw
      from conversation
      where user_id = ${userId}
        ${conversationId === undefined ? sql`` : sql`and id = ${conversationId}`}
      order by last_message_at desc nulls last, id
    `)
    .pipe(
      Effect.map((result) =>
        (
          result.rows as unknown as ReadonlyArray<{
            id: string
            channel: string
            account_id: string
            external_id: string
            url: string | null
            person_name: string | null
            person_id: string | null
            raw: Record<string, unknown> | null
          }>
        ).map((row) => ({
          id: row.id,
          channel: row.channel as ConversationChannel,
          accountId: row.account_id,
          externalId: row.external_id,
          url: row.url,
          personName: row.person_name,
          personId: row.person_id,
          raw: row.raw ?? {}
        }))
      )
    )

/** Адреса отправителей писем диалога, от частых к редким (для канала mail). */
export const mailSenders = (
  tx: Executor,
  conversationId: string
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select lower(from_json -> 0 ->> 'address') as address, count(*)::int as n
      from mail_message
      where conversation_id = ${conversationId} and from_json -> 0 ->> 'address' is not null
      group by 1
      order by n desc, 1
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ address: string }>).map((row) => row.address)
      )
    )

/**
 * Наибольший числовой `external_id` сообщения диалога (Telegram нумерует
 * сообщения по возрастанию). Нечисловые id игнорируются; `null`, если сообщений нет.
 */
export const maxNumericMessageId = (
  tx: Executor,
  userId: string,
  conversationId: string
): RepoEffect<number | null> =>
  tx
    .execute(sql`
      select max(external_id::bigint)::text as max_id from conversation_message
      where user_id = ${userId} and conversation_id = ${conversationId}
        and external_id ~ '^[0-9]{1,18}$'
    `)
    .pipe(
      Effect.map((result) => {
        const value = (result.rows[0] as { max_id?: string | null } | undefined)?.max_id
        return value === null || value === undefined ? null : Number(value)
      })
    )

/** Диалоги, ждущие вакансии hh с этими внешними id (для перелинковки после загрузки вакансий). */
export const conversationsAwaitingVacancies = (
  tx: Executor,
  userId: string,
  source: string,
  externalIds: ReadonlyArray<string>
): RepoEffect<ReadonlyArray<string>> => {
  if (externalIds.length === 0) return Effect.succeed([])
  return tx
    .execute(sql`
      select distinct conversation_id::text as id from conversation_vacancy_ref
      where user_id = ${userId} and source = ${source}
        and external_id in (${sql.join(externalIds.map((id) => sql`${id}`), sql`, `)})
    `)
    .pipe(
      Effect.map((result) => (result.rows as unknown as ReadonlyArray<{ id: string }>).map((row) => row.id))
    )
}
