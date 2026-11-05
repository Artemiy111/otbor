import type { ResumeId, ResumeRecord, ResumeEnrichment, ResumeSyncStatus, SalaryCurrency } from "@otbor/contract"
import { call } from "@/shared/api"

export interface ResumeUpsertInput {
  readonly id?: string
  readonly hhAccountId: string
  readonly source?: string
  readonly externalId: string
  readonly title: string
  readonly text: string
  readonly about?: string
  readonly skills?: ReadonlyArray<string>
  readonly experience?: unknown
  readonly education?: unknown
  readonly workFormats?: ReadonlyArray<string>
  readonly salaryAmount?: number | null
  readonly salaryCurrency?: string | null
  readonly status?: string | null
  readonly isActive?: boolean
}

export const resumeApi = {
  syncRun: (hhAccountId: string): Promise<ResumeSyncStatus> =>
    call((client) => client.ResumeSyncRun({ hhAccountId: hhAccountId as any })),
  syncStatus: (hhAccountId: string): Promise<ResumeSyncStatus> =>
    call((client) => client.ResumeSyncStatus({ hhAccountId: hhAccountId as any })),
  list: (hhAccountId?: string): Promise<ReadonlyArray<ResumeRecord>> =>
    call((client) => client.ResumesList({ hhAccountId: hhAccountId as any })),
  get: (id: string): Promise<ResumeRecord> =>
    call((client) => client.ResumeGet({ id: id as ResumeId })),
  upsert: (input: ResumeUpsertInput): Promise<ResumeRecord> =>
    call((client) =>
      client.ResumeUpsert({
        id: input.id as ResumeId | undefined,
        hhAccountId: input.hhAccountId as any,
        source: input.source,
        externalId: input.externalId,
        title: input.title,
        text: input.text,
        about: input.about,
        skills: input.skills as any,
        experience: input.experience,
        education: input.education,
        workFormats: input.workFormats as any,
        salaryAmount: input.salaryAmount,
        salaryCurrency: input.salaryCurrency,
        status: input.status,
        isActive: input.isActive
      })
    ),
  enrichmentGet: (resumeId: string): Promise<ResumeEnrichment> =>
    call((client) => client.ResumeEnrichmentGet({ resumeId: resumeId as ResumeId })),
  enrichmentSave: (resumeId: string, data: {
    comment?: string
    salaries?: Array<{ currency: SalaryCurrency; min: number | null; expectation: number | null }>
    faq?: Array<{ key: string; question?: string | null; answer: string }>
    experience?: Array<{ key: string; employmentType?: string | null; comment?: string | null; leaveReason?: string | null }>
  }): Promise<ResumeEnrichment> =>
    call((client) => client.ResumeEnrichmentSave({ resumeId: resumeId as ResumeId, data }))
}
