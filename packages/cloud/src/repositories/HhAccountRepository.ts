import type { HhAccountRecord, HhSessionState } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

export interface StoredHhAccount {
  readonly id: string
  readonly user_id: string
  readonly label: string | null
  readonly is_default: boolean
  readonly first_name: string | null
  readonly last_name: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly area_name: string | null
  readonly session_profile: string | null
  readonly color?: string | null
  readonly submit_blocked_at?: Date | string | null
  readonly submit_block_reason?: string | null
  readonly submit_block_detail?: string | null
  readonly session_state?: string | null
  readonly session_last_ok_at?: Date | string | null
  readonly session_last_error?: string | null
  readonly session_updated_at?: Date | string | null
  readonly contact_phone?: string | null
  readonly contact_email?: string | null
  readonly contact_telegram?: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toRecord = (row: StoredHhAccount): HhAccountRecord => ({
  id: row.id as HhAccountRecord["id"],
  label: row.label ?? "",
  isDefault: row.is_default,
  sessionProfile: row.session_profile,
  firstName: row.first_name,
  lastName: row.last_name,
  areaName: row.area_name,
  color: row.color ?? null,
  submitBlockedAt: row.submit_blocked_at == null ? null : iso(row.submit_blocked_at),
  submitBlockReason: row.submit_block_reason ?? null,
  submitBlockDetail: row.submit_block_detail ?? null,
  session:
    row.session_state === null || row.session_state === undefined
      ? null
      : {
          state: row.session_state as HhSessionState,
          lastOkAt:
            row.session_last_ok_at === null || row.session_last_ok_at === undefined
              ? null
              : iso(row.session_last_ok_at),
          lastError: row.session_last_error ?? null,
          updatedAt: iso(row.session_updated_at ?? row.updated_at)
        },
  contacts:
    row.contact_phone == null && row.contact_email == null && row.contact_telegram == null
      ? null
      : {
          phone: row.contact_phone ?? null,
          email: row.contact_email ?? null,
          telegram: row.contact_telegram ?? null
        },
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

const selection = sql`
  select a.id, a.user_id, a.label, a.is_default, a.first_name, a.last_name, a.email,
         a.phone, a.area_name, a.session_profile, a.color, a.created_at, a.updated_at,
         a.submit_blocked_at, a.submit_block_reason, a.submit_block_detail,
         s.state as session_state, s.last_ok_at as session_last_ok_at,
         s.last_error as session_last_error, s.updated_at as session_updated_at,
         (select c.value from hh_account_contact c where c.hh_account_id = a.id and c.kind = 'phone'
           order by c.last_seen_at desc limit 1) as contact_phone,
         (select c.value from hh_account_contact c where c.hh_account_id = a.id and c.kind = 'email'
           order by c.last_seen_at desc limit 1) as contact_email,
         (select c.value from hh_account_contact c where c.hh_account_id = a.id and c.kind = 'telegram'
           order by c.last_seen_at desc limit 1) as contact_telegram
  from hh_account a
  left join hh_account_session s on s.hh_account_id = a.id
`

export const list = (
  tx: Executor,
  userId: string
): RepoEffect<ReadonlyArray<HhAccountRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where a.user_id = ${userId}
      order by a.is_default desc, a.created_at asc
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<StoredHhAccount>).map(toRecord)
      )
    )

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<StoredHhAccount | null> =>
  tx
    .execute(sql`
      ${selection}
      where a.user_id = ${userId} and a.id = ${id}::uuid
      limit 1
    `)
    .pipe(
      Effect.map(
        (result) =>
          (result.rows[0] as unknown as StoredHhAccount | undefined) ?? null
      )
    )

export const findById = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<HhAccountRecord | null> =>
  find(tx, userId, id).pipe(Effect.map((row) => (row === null ? null : toRecord(row))))

export interface UpsertHhAccountInput {
  readonly userId: string
  readonly id?: string | null
  readonly label: string
  readonly isDefault?: boolean
  readonly sessionProfile?: string | null
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly areaName?: string | null
  /** `undefined` keeps the stored colour, `null` clears it. */
  readonly color?: string | null
  readonly now?: Date
}

export const upsert = (
  tx: Executor,
  input: UpsertHhAccountInput
): RepoEffect<HhAccountRecord> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    const isDefault = input.isDefault ?? false
    const label = input.label.trim()
    const existing =
      input.id !== null && input.id !== undefined
        ? yield* find(tx, input.userId, input.id)
        : null

    if (isDefault) {
      yield* tx.execute(sql`
        update hh_account set is_default = false, updated_at = ${now}
        where user_id = ${input.userId} and is_default = true
          ${existing !== null ? sql`and id <> ${existing.id}::uuid` : sql``}
      `)
    }

    if (existing !== null) {
      const result = yield* tx.execute(sql`
        update hh_account set
          label = ${label},
          is_default = ${isDefault},
          session_profile = ${input.sessionProfile === undefined ? existing.session_profile : input.sessionProfile},
          first_name = ${input.firstName === undefined ? existing.first_name : input.firstName},
          last_name = ${input.lastName === undefined ? existing.last_name : input.lastName},
          area_name = ${input.areaName === undefined ? existing.area_name : input.areaName},
          color = ${input.color === undefined ? (existing.color ?? null) : input.color},
          updated_at = ${now}
        where id = ${existing.id}::uuid
        returning id
      `)
      return (yield* findById(tx, input.userId, (result.rows[0] as { id: string }).id))!
    }

    const inserted = yield* tx.execute(sql`
      insert into hh_account (
        user_id, label, is_default, session_profile, first_name, last_name, area_name, color
      ) values (
        ${input.userId}, ${label}, ${isDefault},
        ${input.sessionProfile ?? null},
        ${input.firstName ?? null},
        ${input.lastName ?? null},
        ${input.areaName ?? null},
        ${input.color ?? null}
      )
      returning id
    `)
    return (yield* findById(tx, input.userId, (inserted.rows[0] as { id: string }).id))!
  })

export const findBySessionProfile = (
  tx: Executor,
  userId: string,
  sessionProfile: string
): RepoEffect<HhAccountRecord | null> =>
  tx
    .execute(sql`
      ${selection}
      where a.user_id = ${userId} and a.session_profile = ${sessionProfile}
      order by a.created_at asc
      limit 1
    `)
    .pipe(
      Effect.map((result) =>
        result.rows[0] === undefined
          ? null
          : toRecord(result.rows[0] as unknown as StoredHhAccount)
      )
    )

export interface SetSessionInput {
  readonly userId: string
  readonly id: string
  readonly state: HhSessionState
  readonly error?: string | null
  readonly now?: Date
}

/**
 * Records whether the account's hh.ru login still works. Only the verdict is
 * stored: the cookie jar stays on the operator's disk. `last_ok_at` moves only
 * on `ok`, so it keeps the last time the session was known good.
 */
export const setSession = (
  tx: Executor,
  input: SetSessionInput
): RepoEffect<HhAccountRecord | null> =>
  Effect.gen(function*() {
    const account = yield* find(tx, input.userId, input.id)
    if (account === null) return null
    const now = input.now ?? new Date()
    const ok = input.state === "ok"
    yield* tx.execute(sql`
      insert into hh_account_session (user_id, hh_account_id, state, last_ok_at, last_error, updated_at)
      values (
        ${input.userId}, ${input.id}::uuid, ${input.state},
        ${ok ? now : null}, ${ok ? null : (input.error ?? null)}, ${now}
      )
      on conflict (hh_account_id) do update set
        state = excluded.state,
        last_ok_at = case when ${ok} then ${now}::timestamptz else hh_account_session.last_ok_at end,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `)
    return yield* findById(tx, input.userId, input.id)
  })

export const remove = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      delete from hh_account where user_id = ${userId} and id = ${id}::uuid returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))


/** Профиль браузерной сессии аккаунта (`null`, если аккаунта нет или профиль не задан). */
export const sessionProfileOf = (tx: Executor, hhAccountId: string): RepoEffect<string | null> =>
  tx
    .execute(sql`select session_profile from hh_account where id = ${hhAccountId} limit 1`)
    .pipe(
      Effect.map(
        (result) => (result.rows[0] as { session_profile: string | null } | undefined)?.session_profile ?? null
      )
    )
