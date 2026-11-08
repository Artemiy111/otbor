import type {
  ContactKind,
  ContactRecord,
  ContactSource,
  PersonId,
  PersonLink,
  VacancyId
} from "@otbor/contract"
import { extractContactsFromText } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/**
 * Contacts are identities, not people: the same human may leave an e-mail in a
 * vacancy and a Telegram handle in a chat, and both rows are useful. The unique
 * key is `(user_id, kind, value)`, so repeated extraction moves evidence and
 * `last_seen_at` forward instead of growing the table.
 */

export interface ContactRow {
  readonly id: string
  readonly person_name: string | null
  readonly person_role: string | null
  readonly kind: string
  readonly value: string
  readonly url: string | null
  readonly source: string
  readonly confidence: number | null
  readonly evidence: string | null
  readonly is_bot: boolean
  readonly vacancy_id: string | null
  readonly employer_id: string | null
  readonly person_id: string | null
  readonly person_link: string | null
  readonly first_seen_at: Date | string
  readonly last_seen_at: Date | string
  readonly hh_account_ids?: ReadonlyArray<string> | null
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toRecord = (row: ContactRow): ContactRecord => ({
  id: row.id as ContactRecord["id"],
  personName: row.person_name,
  personRole: row.person_role,
  kind: row.kind as ContactRecord["kind"],
  value: row.value,
  url: row.url,
  source: row.source as ContactRecord["source"],
  confidence: row.confidence,
  evidence: row.evidence,
  isBot: row.is_bot,
  vacancyId: row.vacancy_id as VacancyId | null,
  employerId: row.employer_id as ContactRecord["employerId"],
  personId: row.person_id as PersonId | null,
  personLink: row.person_link as PersonLink | null,
  firstSeenAt: iso(row.first_seen_at),
  lastSeenAt: iso(row.last_seen_at),
  hhAccountIds: row.hh_account_ids ?? []
})

export interface ContactFilter {
  readonly query?: string
  readonly kind?: ContactKind
  readonly source?: ContactSource
  readonly vacancyId?: string
  readonly limit?: number
  readonly offset?: number
}

const selection = sql`
  select id, person_name, person_role, kind, value, url, source, confidence,
         evidence, is_bot, vacancy_id, employer_id, person_id, person_link,
         first_seen_at, last_seen_at,
         coalesce((
           select array_agg(distinct cv.account_id order by cv.account_id)
           from (
             select c.account_id
             from conversation_vacancy link
             join conversation c on c.id = link.conversation_id
             where link.vacancy_id = contact.vacancy_id
               and c.channel = 'hh_chat'
               and c.account_id <> ''
           ) cv
         ), '{}') as hh_account_ids
  from contact
`

export const list = (
  tx: Executor,
  userId: string,
  filter: ContactFilter = {}
): RepoEffect<{
  readonly items: ReadonlyArray<ContactRecord>
  readonly total: number
}> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
    const offset = Math.max(filter.offset ?? 0, 0)
    const query = filter.query?.trim() ?? ""
    const pattern = query === "" ? null : `%${query.replace(/[%_\\]/g, "\\$&")}%`

    const conditions = [sql`user_id = ${userId}`]
    if (filter.kind !== undefined) conditions.push(sql`kind = ${filter.kind}`)
    if (filter.source !== undefined) conditions.push(sql`source = ${filter.source}`)
    if (filter.vacancyId !== undefined) conditions.push(sql`vacancy_id = ${filter.vacancyId}`)
    if (pattern !== null) {
      conditions.push(sql`(person_name ilike ${pattern} or value ilike ${pattern})`)
    }

    const where = sql.join(conditions, sql` and `)
    const rows = yield* tx.execute(sql`
      ${selection}
      where ${where}
      order by last_seen_at desc, id
      limit ${limit} offset ${offset}
    `)
    const total = yield* tx.execute(sql`
      select count(*)::int as count from contact where ${where}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<ContactRow>).map(toRecord),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })

/** Re-runs vacancy contact extraction for one user; idempotent by contact key. */
export const extractFromVacancies = (
  tx: Executor,
  userId: string
): RepoEffect<{ readonly scanned: number; readonly contacts: number }> =>
  Effect.gen(function*() {
    const rows = yield* tx.execute(sql`
      select id::text as id, title, description_text, employer_id::text as employer_id
      from vacancy
      where description_text is not null and length(description_text) > 0
      order by published_at desc nulls last
    `)
    let contacts = 0

    for (const row of rows.rows as unknown as ReadonlyArray<{
      id: string
      title: string
      description_text: string
      employer_id: string | null
    }>) {
      const extraction = extractContactsFromText(
        [row.title, row.description_text].filter(Boolean).join("\n")
      )
      if (extraction.contacts.length === 0) continue
      yield* upsertMany(tx, {
        userId,
        contacts: extraction.contacts,
        source: "hh_vacancy",
        vacancyId: row.id,
        employerId: row.employer_id
      })
      contacts += extraction.contacts.length
    }

    return { scanned: rows.rows.length, contacts }
  })

export const findById = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<ContactRecord | null> =>
  tx
    .execute(sql`
      ${selection}
      where id = ${id} and user_id = ${userId}
      limit 1
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as ContactRow | undefined
        return row === undefined ? null : toRecord(row)
      })
    )

export interface ContactInput {
  readonly kind: ContactKind
  readonly value: string
  readonly raw?: string | null
  readonly url?: string | null
  readonly evidence?: string | null
  readonly confidence?: number | null
  readonly personName?: string | null
  readonly personRole?: string | null
  readonly isBot?: boolean | null
  /** Человек, которому принадлежит идентичность; вместе с `personLink`. */
  readonly personId?: string | null
  readonly personLink?: PersonLink | null
}

export interface UpsertContactsInput {
  readonly userId: string
  readonly contacts: ReadonlyArray<ContactInput>
  readonly source: ContactSource
  readonly vacancyId?: string | null
  readonly employerId?: string | null
  /** Evidence applied when a candidate carries none. */
  readonly evidence?: string | null
  readonly now?: Date
}

export interface UpsertContactsResult {
  readonly inserted: number
  readonly updated: number
}

/**
 * Idempotent upsert. A new sighting may improve a field but never erases one:
 * `coalesce` keeps the old name/site when the new row has no answer, and
 * confidence moves to the maximum.
 *
 * Привязка к человеку (`personId`/`personLink`) осторожнее остальных полей:
 * ручная (`manual`) никогда не перезаписывается, а предложение (`suggested`)
 * не отбирает контакт у человека, к которому он уже привязан.
 */
export const upsertMany = (
  tx: Executor,
  input: UpsertContactsInput
): RepoEffect<UpsertContactsResult> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    let inserted = 0
    let updated = 0

    for (const contact of input.contacts) {
      const result = yield* tx.execute(sql`
        insert into contact (
          user_id, person_name, person_role, kind, value, url, source,
          confidence, evidence, is_bot, vacancy_id, employer_id,
          person_id, person_link, first_seen_at, last_seen_at
        ) values (
          ${input.userId},
          ${contact.personName ?? null},
          ${contact.personRole ?? null},
          ${contact.kind},
          ${contact.value},
          ${contact.url ?? null},
          ${input.source},
          ${contact.confidence ?? null},
          ${contact.evidence ?? input.evidence ?? null},
          ${contact.isBot ?? false},
          ${input.vacancyId ?? null},
          ${input.employerId ?? null},
          ${contact.personId ?? null},
          ${contact.personId == null ? null : (contact.personLink ?? "auto")},
          ${now},
          ${now}
        )
        on conflict (user_id, kind, value) do update set
          person_name = coalesce(excluded.person_name, contact.person_name),
          person_role = coalesce(excluded.person_role, contact.person_role),
          url = coalesce(excluded.url, contact.url),
          source = excluded.source,
          confidence = greatest(
            coalesce(contact.confidence, 0),
            coalesce(excluded.confidence, 0)
          ),
          evidence = coalesce(excluded.evidence, contact.evidence),
          is_bot = contact.is_bot or excluded.is_bot,
          vacancy_id = coalesce(excluded.vacancy_id, contact.vacancy_id),
          employer_id = coalesce(excluded.employer_id, contact.employer_id),
          person_id = case
            when contact.person_link = 'manual' then contact.person_id
            when contact.person_id is not null and excluded.person_link = 'suggested'
              then contact.person_id
            else coalesce(excluded.person_id, contact.person_id)
          end,
          person_link = case
            when contact.person_link = 'manual' then contact.person_link
            when contact.person_id is not null and excluded.person_link = 'suggested'
              then contact.person_link
            else coalesce(excluded.person_link, contact.person_link)
          end,
          last_seen_at = excluded.last_seen_at
        returning (xmax = 0) as inserted
      `)

      const row = result.rows[0] as { inserted?: boolean } | undefined
      if (row?.inserted === true) inserted += 1
      else updated += 1
    }

    return { inserted, updated }
  })

export const remove = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`delete from contact where id = ${id} and user_id = ${userId} returning id`)
    .pipe(Effect.map((result) => result.rows.length > 0))
