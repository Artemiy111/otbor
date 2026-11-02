import type { MailAccountRecord } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Mail account rows, folder UID cursors and stored messages. */

export interface StoredMailAccount {
  readonly id: string
  readonly user_id: string
  readonly label: string
  readonly address: string
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly username: string
  readonly secret_ref: string | null
  readonly include_sent: boolean
  readonly backfill_days: number
  readonly status: string
  readonly enabled: boolean
  readonly last_sync_at: Date | string | null
  readonly last_error: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export const toRecord = (row: StoredMailAccount): MailAccountRecord => ({
  id: row.id as MailAccountRecord["id"],
  label: row.label,
  address: row.address,
  host: row.host,
  port: Number(row.port),
  secure: row.secure,
  username: row.username,
  includeSent: row.include_sent,
  backfillDays: Number(row.backfill_days),
  status: row.status,
  enabled: row.enabled,
  lastSyncAt: iso(row.last_sync_at),
  lastError: row.last_error,
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!
})

const selection = sql`
  select id, user_id, label, address, host, port, secure, username, secret_ref,
         include_sent, backfill_days, status, enabled, last_sync_at, last_error,
         created_at, updated_at
  from mail_account
`

export const list = (
  tx: Executor,
  userId: string
): RepoEffect<ReadonlyArray<MailAccountRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId}
      order by created_at asc
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<StoredMailAccount>).map(toRecord)
      )
    )

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<StoredMailAccount | null> =>
  tx
    .execute(sql`
      ${selection}
      where user_id = ${userId} and id = ${id}
      limit 1
    `)
    .pipe(
      Effect.map(
        (result) =>
          (result.rows[0] as unknown as StoredMailAccount | undefined) ?? null
      )
    )

export const findRecord = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<MailAccountRecord | null> =>
  find(tx, userId, id).pipe(Effect.map((row) => (row === null ? null : toRecord(row))))

export interface UpsertMailAccountInput {
  readonly userId: string
  readonly id?: string | null
  readonly label: string
  readonly address: string
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly username: string
  readonly includeSent: boolean
  readonly backfillDays: number
  readonly enabled: boolean
  readonly now?: Date
}

/**
 * Create or edit an account. The unique key is `(user_id, address)`, so adding
 * the same mailbox twice edits it instead of failing a constraint by surprise.
 * `secret_ref` is the account id: the credential file is named by it.
 */
export const upsert = (
  tx: Executor,
  input: UpsertMailAccountInput
): RepoEffect<MailAccountRecord> =>
  Effect.gen(function*() {
    const now = input.now ?? new Date()
    const existing =
      input.id !== null && input.id !== undefined
        ? yield* find(tx, input.userId, input.id)
        : yield* tx
            .execute(sql`
              ${selection}
              where user_id = ${input.userId} and address = ${input.address}
              limit 1
            `)
            .pipe(
              Effect.map(
                (result) =>
                  (result.rows[0] as unknown as StoredMailAccount | undefined) ?? null
              )
            )

    if (existing !== null) {
      const result = yield* tx.execute(sql`
        update mail_account set
          label = ${input.label},
          address = ${input.address},
          host = ${input.host},
          port = ${input.port},
          secure = ${input.secure},
          username = ${input.username},
          secret_ref = coalesce(secret_ref, ${existing.id}),
          include_sent = ${input.includeSent},
          backfill_days = ${input.backfillDays},
          enabled = ${input.enabled},
          updated_at = ${now}
        where id = ${existing.id}
        returning *
      `)
      return toRecord(result.rows[0] as unknown as StoredMailAccount)
    }

    const inserted = yield* tx.execute(sql`
      insert into mail_account (
        user_id, label, address, host, port, secure, username, include_sent,
        backfill_days, enabled, status
      ) values (
        ${input.userId}, ${input.label}, ${input.address}, ${input.host},
        ${input.port}, ${input.secure}, ${input.username}, ${input.includeSent},
        ${input.backfillDays}, ${input.enabled}, 'idle'
      )
      returning *
    `)
    const row = inserted.rows[0] as unknown as StoredMailAccount
    yield* tx.execute(sql`
      update mail_account set secret_ref = id where id = ${row.id}
    `)
    return toRecord({ ...row, secret_ref: row.id })
  })

export const remove = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      delete from mail_account where user_id = ${userId} and id = ${id} returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface MailStatusInput {
  readonly status: "idle" | "ok" | "error" | "auth_failed"
  readonly lastError?: string | null
  readonly lastSyncAt?: Date | null
}

export const setStatus = (
  tx: Executor,
  id: string,
  input: MailStatusInput
): RepoEffect<void> =>
  tx
    .execute(sql`
      update mail_account set
        status = ${input.status},
        last_error = ${input.lastError ?? null},
        last_sync_at = coalesce(${input.lastSyncAt ?? null}, last_sync_at),
        updated_at = now()
      where id = ${id}
    `)
    .pipe(Effect.asVoid)

/* -------------------------------------------------------------------------- */
/* Folders                                                                    */
/* -------------------------------------------------------------------------- */

export interface StoredFolder {
  readonly account_id: string
  readonly path: string
  readonly role: string
  readonly uid_validity: string | null
  readonly last_uid: number | string
  readonly last_sync_at: Date | string | null
}

export const findFolder = (
  tx: Executor,
  accountId: string,
  path: string
): RepoEffect<StoredFolder | null> =>
  tx
    .execute(sql`
      select account_id, path, role, uid_validity, last_uid, last_sync_at
      from mail_folder
      where account_id = ${accountId} and path = ${path}
      limit 1
    `)
    .pipe(
      Effect.map((result) => (result.rows[0] as unknown as StoredFolder | undefined) ?? null)
    )

export interface UpsertFolderInput {
  readonly userId: string
  readonly accountId: string
  readonly path: string
  readonly role: string
  readonly uidValidity: string | null
  readonly lastUid: number
  readonly now?: Date
}

export const upsertFolder = (
  tx: Executor,
  input: UpsertFolderInput
): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into mail_folder (
        user_id, account_id, path, role, uid_validity, last_uid, last_sync_at
      ) values (
        ${input.userId}, ${input.accountId}, ${input.path}, ${input.role},
        ${input.uidValidity}, ${input.lastUid}, ${input.now ?? new Date()}
      )
      on conflict (account_id, path) do update set
        role = excluded.role,
        uid_validity = coalesce(excluded.uid_validity, mail_folder.uid_validity),
        last_uid = greatest(mail_folder.last_uid, excluded.last_uid),
        last_sync_at = excluded.last_sync_at
    `)
    .pipe(Effect.asVoid)

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export const messageExists = (
  tx: Executor,
  accountId: string,
  rfcMessageId: string
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      select 1 from mail_message
      where account_id = ${accountId} and rfc_message_id = ${rfcMessageId}
      limit 1
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface InsertMailMessageInput {
  readonly userId: string
  readonly accountId: string
  readonly conversationId: string | null
  readonly folder: string
  readonly uid: number
  readonly rfcMessageId: string
  readonly inReplyTo: string | null
  readonly subject: string | null
  readonly from: ReadonlyArray<{ name: string | null; address: string }>
  readonly to: ReadonlyArray<{ name: string | null; address: string }>
  readonly cc: ReadonlyArray<{ name: string | null; address: string }>
  readonly receivedAt: Date | null
  readonly snippet: string | null
  readonly attachmentCount: number
  readonly attachmentNames: ReadonlyArray<string>
  readonly size: number | null
}

/** Callers check `messageExists` first; the unique index is the backstop. */
export const insertMessage = (
  tx: Executor,
  input: InsertMailMessageInput
): RepoEffect<string | null> =>
  tx
    .execute(sql`
      insert into mail_message (
        user_id, account_id, conversation_id, folder, uid, rfc_message_id,
        in_reply_to, subject, from_json, to_json, cc_json, received_at,
        snippet, attachment_count, attachment_names, size
      ) values (
        ${input.userId}, ${input.accountId}, ${input.conversationId},
        ${input.folder}, ${input.uid}, ${input.rfcMessageId}, ${input.inReplyTo},
        ${input.subject}, ${JSON.stringify(input.from)}::jsonb,
        ${JSON.stringify(input.to)}::jsonb, ${JSON.stringify(input.cc)}::jsonb,
        ${input.receivedAt}, ${input.snippet}, ${input.attachmentCount},
        ${JSON.stringify(input.attachmentNames)}::jsonb, ${input.size}
      )
      on conflict (account_id, rfc_message_id) do nothing
      returning id
    `)
    .pipe(
      Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null)
    )
