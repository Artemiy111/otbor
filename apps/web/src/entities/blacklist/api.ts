import type {
  BlacklistId,
  BlacklistRecord,
  BlacklistScope,
  BlacklistTarget,
  HhAccountId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface BlacklistListInput {
  readonly scope?: BlacklistScope
  readonly hhAccountId?: string
  readonly targetType?: BlacklistTarget
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export interface BlacklistListResult {
  readonly items: ReadonlyArray<BlacklistRecord>
  readonly total: number
}

export interface BlacklistUpsertInput {
  readonly id?: string
  readonly scope: BlacklistScope
  readonly hhAccountId?: string
  readonly targetType: BlacklistTarget
  readonly externalId: string
  readonly name?: string
  readonly reason?: string
}

export interface BlacklistRemoveResult {
  readonly id: BlacklistId
  readonly deleted: boolean
}

export interface BlacklistImportEntry {
  readonly targetType: BlacklistTarget
  readonly externalId: string
  readonly name?: string
}

export interface BlacklistImportHhInput {
  readonly hhAccountId: string
  readonly entries: ReadonlyArray<BlacklistImportEntry>
}

export interface BlacklistImportHhResult {
  readonly imported: number
  readonly updated: number
  readonly skipped: number
}

export const blacklistApi = {
  list: (input: BlacklistListInput): Promise<BlacklistListResult> =>
    call((client) =>
      client.BlacklistList({
        scope: input.scope,
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        targetType: input.targetType,
        query: input.query,
        limit: input.limit,
        offset: input.offset
      })
    ),
  upsert: (input: BlacklistUpsertInput): Promise<BlacklistRecord> =>
    call((client) =>
      client.BlacklistUpsert({
        id: input.id as BlacklistId | undefined,
        scope: input.scope,
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        targetType: input.targetType,
        externalId: input.externalId,
        name: input.name,
        reason: input.reason
      })
    ),
  remove: (id: string): Promise<BlacklistRemoveResult> =>
    call((client) => client.BlacklistRemove({ id: id as BlacklistId })),
  importHh: (input: BlacklistImportHhInput): Promise<BlacklistImportHhResult> =>
    call((client) =>
      client.BlacklistImportHh({
        hhAccountId: input.hhAccountId as HhAccountId,
        entries: input.entries.map((entry) => ({
          targetType: entry.targetType,
          externalId: entry.externalId,
          name: entry.name
        }))
      })
    )
}


