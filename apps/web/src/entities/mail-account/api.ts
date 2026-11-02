import type { MailAccountId, MailAccountRecord, SyncResult } from "@otbor/contract"
import { call } from "@/shared/api"

export interface MailAccountUpsertInput {
  readonly id?: string
  readonly label: string
  readonly address: string
  readonly host: string
  readonly port: number
  readonly secure?: boolean
  readonly username: string
  /** App password. Omitted keeps the stored secret; never returned. */
  readonly password?: string
  readonly includeSent?: boolean
  readonly backfillDays?: number
  readonly enabled?: boolean
}

export interface MailAccountRemoveResult {
  readonly id: MailAccountId
  readonly deleted: boolean
}

export interface MailAccountTestResult {
  readonly ok: boolean
  readonly address: string
  readonly folders: number
  readonly messages: number | null
}

export const mailAccountApi = {
  list: (): Promise<ReadonlyArray<MailAccountRecord>> =>
    call((client) => client.MailAccountsList()),
  upsert: (input: MailAccountUpsertInput): Promise<MailAccountRecord> =>
    call((client) =>
      client.MailAccountUpsert({
        ...input,
        id: input.id as MailAccountId | undefined
      })
    ),
  remove: (id: string): Promise<MailAccountRemoveResult> =>
    call((client) => client.MailAccountRemove({ id: id as MailAccountId })),
  test: (id: string): Promise<MailAccountTestResult> =>
    call((client) => client.MailAccountTest({ id: id as MailAccountId })),
  sync: (id: string): Promise<SyncResult> =>
    call((client) => client.MailSyncNow({ id: id as MailAccountId }))
}
