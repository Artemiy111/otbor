import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Зашифрованные cookies аккаунта hh.ru; расшифровывает сервис, не репозиторий. */
export interface StoredSessionState {
  readonly ciphertext: string
  readonly version: number
  readonly updatedAt: string
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString())

export const get = (tx: Executor, hhAccountId: string): RepoEffect<StoredSessionState | null> =>
  tx
    .execute(sql`
      select ciphertext, version, updated_at
      from hh_account_session_state
      where hh_account_id = ${hhAccountId}
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as { ciphertext: string; version: number; updated_at: Date | string } | undefined
        return row === undefined
          ? null
          : { ciphertext: row.ciphertext, version: Number(row.version), updatedAt: iso(row.updated_at) }
      })
    )

/**
 * Записывает состояние, если `baseVersion` совпадает с текущей версией
 * (`null` - строки ещё нет). Возвращает новую версию или `null`, если запись
 * устарела: параллельная задача уже сохранила более свежие cookies.
 */
export const put = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly ciphertext: string
    readonly baseVersion: number | null
  }
): RepoEffect<number | null> =>
  input.baseVersion === null
    ? tx
        .execute(sql`
          insert into hh_account_session_state (hh_account_id, user_id, ciphertext)
          values (${input.hhAccountId}, ${input.userId}, ${input.ciphertext})
          on conflict (hh_account_id) do nothing
          returning version
        `)
        .pipe(Effect.map((result) => (result.rows[0] === undefined ? null : Number((result.rows[0] as { version: number }).version))))
    : tx
        .execute(sql`
          update hh_account_session_state
          set ciphertext = ${input.ciphertext}, version = version + 1, updated_at = now()
          where hh_account_id = ${input.hhAccountId} and version = ${input.baseVersion}
          returning version
        `)
        .pipe(Effect.map((result) => (result.rows[0] === undefined ? null : Number((result.rows[0] as { version: number }).version))))

/** Оператор вошёл заново: состояние заменяется безусловно. */
export const replace = (
  tx: Executor,
  input: { readonly userId: string; readonly hhAccountId: string; readonly ciphertext: string }
): RepoEffect<number> =>
  tx
    .execute(sql`
      insert into hh_account_session_state (hh_account_id, user_id, ciphertext)
      values (${input.hhAccountId}, ${input.userId}, ${input.ciphertext})
      on conflict (hh_account_id) do update
        set ciphertext = excluded.ciphertext, version = hh_account_session_state.version + 1, updated_at = now()
      returning version
    `)
    .pipe(Effect.map((result) => Number((result.rows[0] as { version: number }).version)))
