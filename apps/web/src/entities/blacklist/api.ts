import type {
  BlacklistId,
  BlacklistRecord,
  BlacklistScope,
  BlacklistTarget,
  HhAccountId,
  ResumeId,
  VacancyId
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
  /** Только для `scope = resume`: исключение действует на одно резюме (только вакансии). */
  readonly resumeId?: string
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

export type RejectScope = "app" | "hh_account" | "resume"

export interface RejectVacancyInput {
  readonly vacancyId: string
  readonly scope: RejectScope
  readonly hhAccountId?: string
  readonly resumeId?: string
  readonly reason?: string
}

export interface RejectVacancyResult {
  readonly rejection: BlacklistRecord
  readonly skippedApplications: number
}

export const blacklistApi = {
  /** Отбраковка вакансии: для резюме, аккаунта hh или для всех. */
  rejectVacancy: (input: RejectVacancyInput): Promise<RejectVacancyResult> =>
    call((client) =>
      client.VacancyReject({
        vacancyId: input.vacancyId as VacancyId,
        scope: input.scope,
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        resumeId: input.resumeId as ResumeId | undefined,
        reason: input.reason
      })
    ),
  rejections: (vacancyId: string): Promise<ReadonlyArray<BlacklistRecord>> =>
    call((client) => client.VacancyRejections({ vacancyId: vacancyId as VacancyId })),
  unreject: (id: string): Promise<BlacklistRemoveResult> =>
    call((client) => client.VacancyUnreject({ id: id as BlacklistId })),
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
        resumeId: input.resumeId as ResumeId | undefined,
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


