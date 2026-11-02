import type {
  SyncResult,
  TelegramAccountId,
  TelegramAccountRecord,
  TelegramLoginStatusValue
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface TelegramAccountUpsertInput {
  readonly id?: string
  readonly label: string
  readonly apiId: number
  /** Application hash. Sent once and never rendered back by the API. */
  readonly apiHash: string
  readonly phone?: string
}

export interface TelegramAccountRemoveResult {
  readonly id: TelegramAccountId
  readonly deleted: boolean
}

export interface TelegramLoginQrResult {
  readonly qrUrl: string
  readonly expiresAt: string
}

export interface TelegramLoginStatusResult {
  readonly status: TelegramLoginStatusValue
  readonly error?: string | null
}

export const telegramAccountApi = {
  list: (): Promise<ReadonlyArray<TelegramAccountRecord>> =>
    call((client) => client.TelegramAccountsList()),
  upsert: (input: TelegramAccountUpsertInput): Promise<TelegramAccountRecord> =>
    call((client) =>
      client.TelegramAccountUpsert({
        ...input,
        id: input.id as TelegramAccountId | undefined
      })
    ),
  remove: (id: string): Promise<TelegramAccountRemoveResult> =>
    call((client) => client.TelegramAccountRemove({ id: id as TelegramAccountId })),
  sync: (id: string): Promise<SyncResult> =>
    call((client) => client.TelegramSyncNow({ id: id as TelegramAccountId })),
  loginQr: (id: string): Promise<TelegramLoginQrResult> =>
    call((client) => client.TelegramLoginQr({ id: id as TelegramAccountId })),
  loginStatus: (id: string): Promise<TelegramLoginStatusResult> =>
    call((client) => client.TelegramLoginStatus({ id: id as TelegramAccountId }))
}
