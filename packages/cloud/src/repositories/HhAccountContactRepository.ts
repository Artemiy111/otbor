import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Собственные контакты hh-аккаунта (телефон, почта, Telegram) из блока «Контакты» профиля. */

export type ContactKind = "phone" | "email" | "telegram"

/** Идемпотентный upsert по (hh_account_id, kind, value); повторное чтение двигает last_seen_at. */
export const upsert = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly kind: ContactKind
    readonly value: string
    readonly raw: string
    readonly now: Date
  }
): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into hh_account_contact (user_id, hh_account_id, kind, value, raw, first_seen_at, last_seen_at)
      values (${input.userId}, ${input.hhAccountId}::uuid, ${input.kind}, ${input.value}, ${input.raw}, ${input.now}, ${input.now})
      on conflict (hh_account_id, kind, value) do update set
        raw = excluded.raw,
        last_seen_at = excluded.last_seen_at
    `)
    .pipe(Effect.asVoid)

/** Удаляет значения вида `kind`, которых нет среди `keep` (профиль их больше не показывает). */
export const deleteStale = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly kind: ContactKind
    readonly keep: string | null
  }
): RepoEffect<void> =>
  tx
    .execute(sql`
      delete from hh_account_contact
      where user_id = ${input.userId}
        and hh_account_id = ${input.hhAccountId}::uuid
        and kind = ${input.kind}
        and (${input.keep}::text is null or value <> ${input.keep}::text)
    `)
    .pipe(Effect.asVoid)

/**
 * Привязывает к hh-аккаунту telegram-аккаунты пользователя с тем же username
 * (без учёта регистра). Возвращает число подходящих telegram-аккаунтов.
 */
export const linkTelegramAccounts = (
  tx: Executor,
  input: { readonly userId: string; readonly hhAccountId: string; readonly handle: string }
): RepoEffect<number> =>
  tx
    .execute(sql`
      insert into telegram_account_hh_account (user_id, telegram_account_id, hh_account_id, source)
      select t.user_id, t.id, ${input.hhAccountId}::uuid, 'auto'
      from telegram_account t
      where t.user_id = ${input.userId}
        and lower(ltrim(t.username, '@')) = lower(ltrim(${input.handle}, '@'))
      on conflict do nothing
      returning 1
    `)
    .pipe(Effect.map((result) => result.rows.length))
