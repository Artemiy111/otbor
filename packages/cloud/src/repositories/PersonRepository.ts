import type {
  ContactRecord,
  ConversationSummary,
  EmployerId,
  PersonId,
  PersonLink,
  PersonRecord,
  PersonSummary,
  ResumeId,
  VacancyId
} from "@otbor/contract"
import type { ExistingContact, OwnIdentities } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as ContactRepository from "./ContactRepository.ts"
import * as ConversationRepository from "./ConversationRepository.ts"

/**
 * Люди — это группы контактов-идентичностей и диалогов одного собеседника.
 * Слияние ничего не удаляет: проигравший остаётся строкой со ссылкой
 * `merged_into_id`, поэтому старые ссылки продолжают вести к победителю.
 */

interface PersonRow {
  readonly id: string
  readonly display_name: string | null
  readonly role: string | null
  readonly employer_id: string | null
  readonly notes: string | null
  readonly merged_into_id: string | null
  readonly contact_count: number
  readonly conversation_count: number
  readonly last_seen_at: Date | string | null
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toSummary = (row: PersonRow): PersonSummary => ({
  id: row.id as PersonId,
  displayName: row.display_name,
  role: row.role,
  employerId: row.employer_id as EmployerId | null,
  contactCount: Number(row.contact_count),
  conversationCount: Number(row.conversation_count),
  lastSeenAt: iso(row.last_seen_at)
})

const selection = sql`
  select p.id::text as id, p.display_name, p.role, p.employer_id::text as employer_id,
         p.notes, p.merged_into_id::text as merged_into_id,
         (select count(*)::int from contact c where c.person_id = p.id) as contact_count,
         (select count(*)::int from conversation v where v.person_id = p.id) as conversation_count,
         greatest(
           (select max(c.last_seen_at) from contact c where c.person_id = p.id),
           (select max(v.last_message_at) from conversation v where v.person_id = p.id)
         ) as last_seen_at
  from person p
`

export interface PersonFilter {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

/** Живые люди (не слитые), свежие сверху. */
export const list = (
  tx: Executor,
  userId: string,
  filter: PersonFilter = {}
): RepoEffect<{ readonly items: ReadonlyArray<PersonSummary>; readonly total: number }> =>
  Effect.gen(function*() {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
    const offset = Math.max(filter.offset ?? 0, 0)
    const query = filter.query?.trim() ?? ""
    const pattern = query === "" ? null : `%${query.replace(/[%_\\]/g, "\\$&")}%`

    const conditions = [sql`p.user_id = ${userId}`, sql`p.merged_into_id is null`]
    if (pattern !== null) {
      conditions.push(sql`(
        p.display_name ilike ${pattern}
        or exists (
          select 1 from contact c
          where c.person_id = p.id and (c.value ilike ${pattern} or c.person_name ilike ${pattern})
        )
      )`)
    }
    const where = sql.join(conditions, sql` and `)

    const rows = yield* tx.execute(sql`
      ${selection}
      where ${where}
      order by last_seen_at desc nulls last, p.id
      limit ${limit} offset ${offset}
    `)
    const total = yield* tx.execute(sql`
      select count(*)::int as count from person p where ${where}
    `)

    return {
      items: (rows.rows as unknown as ReadonlyArray<PersonRow>).map(toSummary),
      total: Number((total.rows[0] as { count?: number } | undefined)?.count ?? 0)
    }
  })

/** Строка человека без учёта слияния. */
const findRow = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<PersonRow | null> =>
  tx
    .execute(sql`
      ${selection}
      where p.id = ${id} and p.user_id = ${userId}
      limit 1
    `)
    .pipe(
      Effect.map((result) => (result.rows[0] as unknown as PersonRow | undefined) ?? null)
    )

/** Следует по цепочке слияний до живого человека. */
export const resolveId = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<string | null> =>
  Effect.gen(function*() {
    let current = id
    for (let hop = 0; hop < 16; hop++) {
      const row = yield* findRow(tx, userId, current)
      if (row === null) return null
      if (row.merged_into_id === null) return row.id
      current = row.merged_into_id
    }
    return null
  })

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<PersonSummary | null> =>
  Effect.gen(function*() {
    const resolved = yield* resolveId(tx, userId, id)
    if (resolved === null) return null
    const row = yield* findRow(tx, userId, resolved)
    return row === null ? null : toSummary(row)
  })

export const get = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<PersonRecord | null> =>
  Effect.gen(function*() {
    const resolved = yield* resolveId(tx, userId, id)
    if (resolved === null) return null
    const row = yield* findRow(tx, userId, resolved)
    if (row === null) return null

    const contacts = yield* tx.execute(sql`
      select id from contact where person_id = ${resolved} and user_id = ${userId}
      order by last_seen_at desc, id
    `)
    const records: Array<ContactRecord> = []
    for (const contact of contacts.rows as unknown as ReadonlyArray<{ id: string }>) {
      const record = yield* ContactRepository.findById(tx, userId, contact.id)
      if (record !== null) records.push(record)
    }

    const conversations = yield* ConversationRepository.list(tx, userId, {
      personId: resolved,
      limit: 200
    })

    const vacancies = yield* tx.execute(sql`
      select distinct cv.vacancy_id::text as id
      from conversation_vacancy cv
      join conversation c on c.id = cv.conversation_id
      where c.person_id = ${resolved} and c.user_id = ${userId} and cv.kind <> 'candidate'
    `)
    const resumes = yield* tx.execute(sql`
      select distinct cr.resume_id::text as id
      from conversation_resume cr
      join conversation c on c.id = cr.conversation_id
      where c.person_id = ${resolved} and c.user_id = ${userId}
    `)

    return {
      ...toSummary(row),
      notes: row.notes,
      contacts: records,
      conversations: conversations as ReadonlyArray<ConversationSummary>,
      vacancyIds: (vacancies.rows as unknown as ReadonlyArray<{ id: string }>).map(
        (item) => item.id as VacancyId
      ),
      resumeIds: (resumes.rows as unknown as ReadonlyArray<{ id: string }>).map(
        (item) => item.id as ResumeId
      )
    }
  })

export interface CreatePersonInput {
  readonly userId: string
  readonly displayName?: string | null
  readonly role?: string | null
  readonly employerId?: string | null
  readonly notes?: string | null
}

export const create = (tx: Executor, input: CreatePersonInput): RepoEffect<string> =>
  tx
    .execute(sql`
      insert into person (user_id, display_name, role, employer_id, notes)
      values (
        ${input.userId}, ${input.displayName ?? null}, ${input.role ?? null},
        ${input.employerId ?? null}, ${input.notes ?? null}
      )
      returning id::text as id
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id: string }).id))

export interface UpdatePersonInput {
  /** `undefined` — не менять, `null` — очистить. */
  readonly name?: string | null
  readonly role?: string | null
  readonly notes?: string | null
}

export const update = (
  tx: Executor,
  userId: string,
  id: string,
  input: UpdatePersonInput
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update person set
        display_name = case when ${input.name !== undefined} then ${input.name ?? null} else display_name end,
        role = case when ${input.role !== undefined} then ${input.role ?? null} else role end,
        notes = case when ${input.notes !== undefined} then ${input.notes ?? null} else notes end
      where id = ${id} and user_id = ${userId} and merged_into_id is null
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Заполняет пустые имя и должность, не затирая введённое оператором. */
export const fillMissing = (
  tx: Executor,
  userId: string,
  id: string,
  input: { readonly name?: string | null; readonly role?: string | null }
): RepoEffect<void> =>
  tx
    .execute(sql`
      update person set
        display_name = coalesce(display_name, ${input.name ?? null}),
        role = coalesce(role, ${input.role ?? null})
      where id = ${id} and user_id = ${userId}
    `)
    .pipe(Effect.asVoid)

/**
 * Переносит контакты и диалоги `from` к `into`; пустые поля победителя
 * заполняются у проигравшего. Возвращает `false`, если кого-то из двоих нет,
 * они совпадают или один уже слит.
 */
export const merge = (
  tx: Executor,
  userId: string,
  input: { readonly into: string; readonly from: string }
): RepoEffect<boolean> =>
  Effect.gen(function*() {
    if (input.into === input.from) return false
    const into = yield* findRow(tx, userId, input.into)
    const from = yield* findRow(tx, userId, input.from)
    if (into === null || from === null) return false
    if (into.merged_into_id !== null || from.merged_into_id !== null) return false

    yield* tx.execute(sql`
      update contact set person_id = ${input.into}
      where person_id = ${input.from} and user_id = ${userId}
    `)
    yield* tx.execute(sql`
      update conversation set person_id = ${input.into}
      where person_id = ${input.from} and user_id = ${userId}
    `)
    yield* tx.execute(sql`
      update person set
        display_name = coalesce(display_name, ${from.display_name}),
        role = coalesce(role, ${from.role}),
        employer_id = coalesce(employer_id, ${from.employer_id}),
        notes = case
          when notes is null then ${from.notes}
          when ${from.notes}::text is null then notes
          else notes || E'\n' || ${from.notes}
        end
      where id = ${input.into}
    `)
    yield* tx.execute(sql`
      update person set merged_into_id = ${input.into}
      where id = ${input.from} and user_id = ${userId}
    `)
    // Все, кто был слит в проигравшего, теперь указывают на победителя.
    yield* tx.execute(sql`
      update person set merged_into_id = ${input.into}
      where merged_into_id = ${input.from} and user_id = ${userId}
    `)
    return true
  })

/** Отделяет контакт в нового человека; привязка ручная. `null`, если контакта нет. */
export const split = (
  tx: Executor,
  userId: string,
  contactId: string
): RepoEffect<string | null> =>
  Effect.gen(function*() {
    const found = yield* tx.execute(sql`
      select person_name, person_role, employer_id::text as employer_id
      from contact where id = ${contactId} and user_id = ${userId}
    `)
    const row = found.rows[0] as
      | { person_name: string | null; person_role: string | null; employer_id: string | null }
      | undefined
    if (row === undefined) return null

    const personId = yield* create(tx, {
      userId,
      displayName: row.person_name,
      role: row.person_role,
      employerId: row.employer_id
    })
    yield* setContactLink(tx, userId, contactId, { personId, link: "manual" })
    return personId
  })

export const setContactLink = (
  tx: Executor,
  userId: string,
  contactId: string,
  input: { readonly personId: string | null; readonly link: PersonLink | null }
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update contact set person_id = ${input.personId}, person_link = ${input.link}
      where id = ${contactId} and user_id = ${userId}
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Подтверждает предложенную привязку: она становится ручной. */
export const confirmContact = (
  tx: Executor,
  userId: string,
  contactId: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update contact set person_link = 'manual'
      where id = ${contactId} and user_id = ${userId} and person_link = 'suggested'
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Отклоняет предложенную привязку: контакт остаётся без человека. */
export const rejectContact = (
  tx: Executor,
  userId: string,
  contactId: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update contact set person_id = null, person_link = null
      where id = ${contactId} and user_id = ${userId} and person_link = 'suggested'
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/* -------------------------------------------------------------------------- */
/* Собственные контакты соискателя                                            */
/* -------------------------------------------------------------------------- */

export interface HhAccountContactInput {
  readonly kind: "phone" | "email" | "telegram"
  readonly value: string
  readonly raw?: string | null
}

export const upsertHhAccountContacts = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly contacts: ReadonlyArray<HhAccountContactInput>
    readonly now?: Date
  }
): RepoEffect<number> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    for (const contact of input.contacts) {
      yield* tx.execute(sql`
        insert into hh_account_contact (
          user_id, hh_account_id, kind, value, raw, first_seen_at, last_seen_at
        ) values (
          ${input.userId}, ${input.hhAccountId}, ${contact.kind}, ${contact.value},
          ${contact.raw ?? null}, ${now}, ${now}
        )
        on conflict (hh_account_id, kind, value) do update set
          raw = coalesce(excluded.raw, hh_account_contact.raw),
          last_seen_at = excluded.last_seen_at
      `)
    }
    return input.contacts.length
  })

/**
 * Собственные идентичности пользователя: контакты профилей hh, почта и телефон
 * аккаунтов hh, ящики и аккаунты Telegram. Их нельзя принимать за собеседника.
 */
export const ownIdentities = (
  tx: Executor,
  userId: string
): RepoEffect<OwnIdentities> =>
  Effect.gen(function*() {
    const emails = new Set<string>()
    const phones = new Set<string>()
    const usernames = new Set<string>()
    const ids = new Set<string>()

    const profile = yield* tx.execute(sql`
      select kind, value from hh_account_contact where user_id = ${userId}
    `)
    for (const row of profile.rows as unknown as ReadonlyArray<{ kind: string; value: string }>) {
      if (row.kind === "email") emails.add(row.value)
      else if (row.kind === "phone") phones.add(row.value)
      else if (row.kind === "telegram") usernames.add(row.value)
    }

    const accounts = yield* tx.execute(sql`
      select email, phone from hh_account where user_id = ${userId}
    `)
    for (const row of accounts.rows as unknown as ReadonlyArray<{
      email: string | null
      phone: string | null
    }>) {
      if (row.email) emails.add(row.email)
      if (row.phone) phones.add(row.phone)
    }

    const mail = yield* tx.execute(sql`
      select address from mail_account where user_id = ${userId}
    `)
    for (const row of mail.rows as unknown as ReadonlyArray<{ address: string }>) {
      emails.add(row.address)
    }

    const telegram = yield* tx.execute(sql`
      select tg_user_id, username from telegram_account where user_id = ${userId}
    `)
    for (const row of telegram.rows as unknown as ReadonlyArray<{
      tg_user_id: string | null
      username: string | null
    }>) {
      if (row.tg_user_id) ids.add(row.tg_user_id)
      if (row.username) usernames.add(row.username)
    }

    return {
      emails: [...emails],
      phones: [...phones],
      telegramUsernames: [...usernames],
      telegramIds: [...ids]
    }
  })

/* -------------------------------------------------------------------------- */
/* Данные для привязки                                                        */
/* -------------------------------------------------------------------------- */

export interface ExistingContactRow extends ExistingContact {
  readonly personLink: PersonLink | null
  readonly vacancyId: string | null
}

/** Сохранённые контакты с заданными ключами (`kind`, нормализованное `value`). */
export const contactsByKeys = (
  tx: Executor,
  userId: string,
  keys: ReadonlyArray<{ readonly kind: string; readonly value: string }>
): RepoEffect<ReadonlyArray<ExistingContactRow>> =>
  Effect.gen(function*() {
    if (keys.length === 0) return []
    const pairs = sql.join(keys.map((key) => sql`(${key.kind}, ${key.value})`), sql`, `)
    const result = yield* tx.execute(sql`
      select kind, value, person_id::text as person_id, person_link, vacancy_id::text as vacancy_id
      from contact
      where user_id = ${userId} and (kind, value) in (${pairs})
    `)
    return (
      result.rows as unknown as ReadonlyArray<{
        kind: string
        value: string
        person_id: string | null
        person_link: string | null
        vacancy_id: string | null
      }>
    ).map((row) => ({
      kind: row.kind,
      value: row.value,
      personId: row.person_id,
      personLink: row.person_link as PersonLink | null,
      vacancyId: row.vacancy_id
    }))
  })

/** Вакансии, с которыми уже связаны другие диалоги и контакты человека. */
export const vacancyIdsOfPerson = (
  tx: Executor,
  userId: string,
  personId: string,
  exceptConversationId: string
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select vacancy_id from (
        select cv.vacancy_id::text as vacancy_id
        from conversation_vacancy cv
        join conversation c on c.id = cv.conversation_id
        where c.person_id = ${personId} and c.user_id = ${userId}
          and c.id <> ${exceptConversationId} and cv.kind <> 'candidate'
        union
        select vacancy_id::text from contact
        where person_id = ${personId} and user_id = ${userId} and vacancy_id is not null
      ) v
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ vacancy_id: string }>).map(
          (row) => row.vacancy_id
        )
      )
    )

/**
 * Аккаунты hh, принадлежащие аккаунту Telegram: ручные и автоматические связи.
 */
export const hhAccountsOfTelegram = (
  tx: Executor,
  userId: string,
  telegramAccountId: string
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select hh_account_id::text as id from telegram_account_hh_account
      where user_id = ${userId} and telegram_account_id = ${telegramAccountId}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<{ id: string }>).map((row) => row.id)
      )
    )

/**
 * Связывает аккаунт Telegram с аккаунтом hh, когда в профиле hh указан тот же
 * username. Ручные связи не трогаются. Возвращает число новых связей.
 */
export const autoLinkTelegramAccounts = (
  tx: Executor,
  userId: string
): RepoEffect<number> =>
  tx
    .execute(sql`
      insert into telegram_account_hh_account (user_id, telegram_account_id, hh_account_id, source)
      select distinct t.user_id, t.id, h.hh_account_id, 'auto'
      from telegram_account t
      join hh_account_contact h
        on h.user_id = t.user_id
       and h.kind = 'telegram'
       and ltrim(lower(h.value), '@') = lower(t.username)
      where t.user_id = ${userId} and t.username is not null
      on conflict (telegram_account_id, hh_account_id) do nothing
      returning telegram_account_id
    `)
    .pipe(Effect.map((result) => result.rows.length))

export interface LinkingApplication {
  readonly vacancyId: string
  readonly resumeId: string
  readonly hhAccountId: string
}

export const applicationsOnVacancies = (
  tx: Executor,
  userId: string,
  vacancyIds: ReadonlyArray<string>
): RepoEffect<ReadonlyArray<LinkingApplication>> => {
  if (vacancyIds.length === 0) return Effect.succeed([])
  return tx
    .execute(sql`
      select vacancy_id::text as vacancy_id, resume_id::text as resume_id,
             hh_account_id::text as hh_account_id
      from application
      where user_id = ${userId} and resume_id is not null
        and vacancy_id in (${sql.join(vacancyIds.map((id) => sql`${id}`), sql`, `)})
    `)
    .pipe(
      Effect.map((result) =>
        (
          result.rows as unknown as ReadonlyArray<{
            vacancy_id: string
            resume_id: string
            hh_account_id: string
          }>
        ).map((row) => ({
          vacancyId: row.vacancy_id,
          resumeId: row.resume_id,
          hhAccountId: row.hh_account_id
        }))
      )
    )
}

export interface LinkingResume {
  readonly resumeId: string
  readonly hhAccountId: string
  readonly active: boolean
}

export const resumesOfAccounts = (
  tx: Executor,
  userId: string,
  hhAccountIds: ReadonlyArray<string>
): RepoEffect<ReadonlyArray<LinkingResume>> => {
  if (hhAccountIds.length === 0) return Effect.succeed([])
  return tx
    .execute(sql`
      select id::text as id, hh_account_id::text as hh_account_id, is_active
      from resume
      where user_id = ${userId}
        and hh_account_id in (${sql.join(hhAccountIds.map((id) => sql`${id}`), sql`, `)})
    `)
    .pipe(
      Effect.map((result) =>
        (
          result.rows as unknown as ReadonlyArray<{
            id: string
            hh_account_id: string
            is_active: boolean
          }>
        ).map((row) => ({
          resumeId: row.id,
          hhAccountId: row.hh_account_id,
          active: row.is_active
        }))
      )
    )
}

/** Резюме hh по внешнему id (для чата hh, который знает резюме точно). */
export const resumeIdByExternal = (
  tx: Executor,
  userId: string,
  externalId: string
): RepoEffect<string | null> =>
  tx
    .execute(sql`
      select id::text as id from resume
      where user_id = ${userId} and source = 'hh' and external_id = ${externalId}
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

/** Резюме отклика, у которого есть этот чат hh: самая точная связь диалога с резюме. */
export const resumeIdByHhChat = (
  tx: Executor,
  userId: string,
  hhAccountId: string,
  chatId: string
): RepoEffect<string | null> =>
  tx
    .execute(sql`
      select resume_id::text as id from application
      where user_id = ${userId} and hh_account_id = ${hhAccountId}::uuid
        and hh_chat_id = ${chatId} and resume_id is not null
      order by updated_at desc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))
