/**
 * Настройки откликов и браузера одного пользователя (`user_settings`).
 *
 * Нет строки - действуют значения по умолчанию, которые облако берёт из
 * окружения при старте. claim читает строку при каждой выдаче задачи, так что
 * правка из интерфейса действует сразу.
 */
import type { UserSettings } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Значения по умолчанию, пока строки настроек нет. */
export const BUILTIN_SETTINGS: UserSettings = {
  accountBrowserConcurrency: 4,
  accountActingConcurrency: 1,
  submitIntervalSeconds: 75,
  submitJitterPercent: 50,
  submitHourlyLimit: null,
  harnessSlots: 6
}

interface SettingsRow {
  readonly account_browser_concurrency: number
  readonly account_acting_concurrency: number
  readonly submit_interval_seconds: number
  readonly submit_jitter_percent: number
  readonly submit_hourly_limit: number | null
  readonly harness_slots: number
  readonly updated_at: Date | string
}

const fromRow = (row: SettingsRow): UserSettings => ({
  accountBrowserConcurrency: Number(row.account_browser_concurrency),
  accountActingConcurrency: Number(row.account_acting_concurrency),
  submitIntervalSeconds: Number(row.submit_interval_seconds),
  submitJitterPercent: Number(row.submit_jitter_percent),
  submitHourlyLimit: row.submit_hourly_limit === null ? null : Number(row.submit_hourly_limit),
  harnessSlots: Number(row.harness_slots)
})

export interface StoredSettings {
  readonly settings: UserSettings
  readonly updatedAt: string
}

/** Сохранённая строка пользователя или `null`, если её нет. */
export const find = (tx: Executor, userId: string): RepoEffect<StoredSettings | null> =>
  tx
    .execute(sql`select * from user_settings where user_id = ${userId}`)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as SettingsRow | undefined
        return row === undefined
          ? null
          : { settings: fromRow(row), updatedAt: new Date(row.updated_at).toISOString() }
      })
    )

/** Действующие настройки: строка пользователя или `defaults`. */
export const effective = (
  tx: Executor,
  userId: string,
  defaults: UserSettings
): RepoEffect<UserSettings> =>
  find(tx, userId).pipe(Effect.map((stored) => stored?.settings ?? defaults))

/** Сохраняет все поля разом (upsert по пользователю). */
export const upsert = (
  tx: Executor,
  userId: string,
  value: UserSettings
): RepoEffect<StoredSettings> =>
  tx
    .execute(sql`
      insert into user_settings (
        user_id, account_browser_concurrency, account_acting_concurrency,
        submit_interval_seconds, submit_jitter_percent, submit_hourly_limit, harness_slots
      ) values (
        ${userId}, ${value.accountBrowserConcurrency}, ${value.accountActingConcurrency},
        ${value.submitIntervalSeconds}, ${value.submitJitterPercent},
        ${value.submitHourlyLimit}::int, ${value.harnessSlots}
      )
      on conflict (user_id) do update set
        account_browser_concurrency = excluded.account_browser_concurrency,
        account_acting_concurrency = excluded.account_acting_concurrency,
        submit_interval_seconds = excluded.submit_interval_seconds,
        submit_jitter_percent = excluded.submit_jitter_percent,
        submit_hourly_limit = excluded.submit_hourly_limit,
        harness_slots = excluded.harness_slots
      returning *
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as SettingsRow
        return { settings: fromRow(row), updatedAt: new Date(row.updated_at).toISOString() }
      })
    )
