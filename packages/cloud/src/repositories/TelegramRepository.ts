import type { TelegramAccountRecord } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Telegram account rows. The session string itself stays on local disk. */

export interface StoredTelegramAccount {
  readonly id: string
  readonly user_id: string
  readonly label: string
  readonly tg_user_id: string | null
  readonly username: string | null
  readonly phone_masked: string | null
  readonly session_ref: string | null
  readonly status: string
  readonly enabled: boolean
  readonly last_sync_at: Date | string | null
  readonly last_error: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toRecord = (row: StoredTelegramAccount): TelegramAccountRecord => ({
  id: row.id as TelegramAccountRecord["id"],
  label: row.label,
  tgUserId: row.tg_user_id,
  username: row.username,
  phoneMasked: row.phone_masked,
  status: row.status,
  enabled: row.enabled,
  lastSyncAt: iso(row.last_sync_at),
  lastError: row.last_error,
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!
})

const selection = sql`
  select id, user_id, label, tg_user_id, username, phone_masked, session_ref,
         status, enabled, last_sync_at, last_error, created_at, updated_at
  from telegram_account
`

export const list = (
  tx: Executor,
  userId: string
): RepoEffect<ReadonlyArray<TelegramAccountRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId}
      order by created_at asc
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<StoredTelegramAccount>).map(toRecord)
      )
    )

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<StoredTelegramAccount | null> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId} and id = ${id}
      limit 1
    `)
    .pipe(
      Effect.map(
        (result) =>
          (result.rows[0] as unknown as StoredTelegramAccount | undefined) ?? null
      )
    )

export const findRecord = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<TelegramAccountRecord | null> =>
  find(tx, userId, id).pipe(Effect.map((row) => (row === null ? null : toRecord(row))))

export interface UpsertTelegramAccountInput {
  readonly userId: string
  readonly id?: string | null
  readonly label: string
  readonly phoneMasked?: string | null
  readonly now?: Date
}

/** Accounts are keyed by user and label; the label is the operator's handle. */
export const upsert = (
  tx: Executor,
  input: UpsertTelegramAccountInput
): RepoEffect<TelegramAccountRecord> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    const existing =
      input.id !== null && input.id !== undefined
        ? yield* find(tx, input.userId, input.id)
        : yield* tx
            .execute(sql`
              ${selection}
              where user_id = ${input.userId} and label = ${input.label}
              limit 1
            `)
            .pipe(
              Effect.map(
                (result) =>
                  (result.rows[0] as unknown as StoredTelegramAccount | undefined) ?? null
              )
            )

    if (existing !== null) {
      const result = yield* tx.execute(sql`
        update telegram_account set
          label = ${input.label},
          phone_masked = coalesce(${input.phoneMasked ?? null}, phone_masked),
          session_ref = coalesce(session_ref, ${existing.id}),
          updated_at = ${now}
        where id = ${existing.id}
        returning *
      `)
      return toRecord(result.rows[0] as unknown as StoredTelegramAccount)
    }

    const inserted = yield* tx.execute(sql`
      insert into telegram_account (user_id, label, phone_masked, status)
      values (${input.userId}, ${input.label}, ${input.phoneMasked ?? null}, 'idle')
      returning *
    `)
    const row = inserted.rows[0] as unknown as StoredTelegramAccount
    yield* tx.execute(sql`
      update telegram_account set session_ref = id where id = ${row.id}
    `)
    return toRecord({ ...row, session_ref: row.id })
  })

export const remove = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      delete from telegram_account where user_id = ${userId} and id = ${id} returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface TelegramProfileInput {
  readonly tgUserId: string | null
  readonly username: string | null
  readonly phoneMasked: string | null
}

export const setProfile = (
  tx: Executor,
  id: string,
  input: TelegramProfileInput
): RepoEffect<void> =>
  tx
    .execute(sql`
      update telegram_account set
        tg_user_id = coalesce(${input.tgUserId}, tg_user_id),
        username = coalesce(${input.username}, username),
        phone_masked = coalesce(${input.phoneMasked}, phone_masked),
        updated_at = now()
      where id = ${id}
    `)
    .pipe(Effect.asVoid)

export const setStatus = (
  tx: Executor,
  id: string,
  input: {
    readonly status: "idle" | "ok" | "error"
    readonly lastError?: string | null
    readonly lastSyncAt?: Date | null
  }
): RepoEffect<void> =>
  tx
    .execute(sql`
      update telegram_account set
        status = ${input.status},
        last_error = ${input.lastError ?? null},
        last_sync_at = coalesce(${input.lastSyncAt ?? null}, last_sync_at),
        updated_at = now()
      where id = ${id}
    `)
    .pipe(Effect.asVoid)
