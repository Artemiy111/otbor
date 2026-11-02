import type { HhAccountRecord, HhAccountId } from "@otbor/contract"
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
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

const selection = sql`
  select id, user_id, label, is_default, first_name, last_name, email, phone,
         area_name, session_profile, created_at, updated_at
  from hh_account
`

export const list = (
  tx: Executor,
  userId: string
): RepoEffect<ReadonlyArray<HhAccountRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId}
      order by is_default desc, created_at asc
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
      where user_id = ${userId} and id = ${id}::uuid
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
          updated_at = ${now}
        where id = ${existing.id}::uuid
        returning *
      `)
      return toRecord(result.rows[0] as unknown as StoredHhAccount)
    }

    const inserted = yield* tx.execute(sql`
      insert into hh_account (
        user_id, label, is_default, session_profile, first_name, last_name, area_name
      ) values (
        ${input.userId}, ${label}, ${isDefault},
        ${input.sessionProfile ?? null},
        ${input.firstName ?? null},
        ${input.lastName ?? null},
        ${input.areaName ?? null}
      )
      returning *
    `)
    return toRecord(inserted.rows[0] as unknown as StoredHhAccount)
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
