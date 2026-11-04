import type {
  NegotiationsSyncStatus,
  ApplicationDetail,
  ApplicationId,
  ApplicationRecord,
  DecisionId,
  HhAccountId,
  KitAnswer,
  KitRecord,
  VacancyId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface ApplicationListInput {
  readonly state?: string
  readonly hhAccountId?: string
  readonly vacancyId?: string
  readonly limit?: number
}

export interface ApplicationCreateFromDecisionInput {
  readonly decisionId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  readonly mode?: "drafts" | "auto"
}

export interface ApplicationSetKitInput {
  readonly applicationId: string
  readonly formHash: string
  readonly letter: string | null
  readonly answers: ReadonlyArray<KitAnswer>
}

export const applicationApi = {
  createManual: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
  }): Promise<{ readonly application: ApplicationRecord; readonly created: boolean }> =>
    call((client) =>
      client.ApplicationsCreateManual({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId
      })
    ),
  setKit: (input: ApplicationSetKitInput): Promise<KitRecord> =>
    call((client) =>
      client.ApplicationsSetKit({
        applicationId: input.applicationId as ApplicationId,
        formHash: input.formHash,
        letter: input.letter,
        answers: input.answers
      })
    ),
  approve: (id: string): Promise<ApplicationRecord> =>
    call((client) => client.ApplicationsApprove({ id: id as ApplicationId })),
  syncRun: (hhAccountId: string): Promise<NegotiationsSyncStatus> =>
    call((client) => client.NegotiationsSyncRun({ hhAccountId: hhAccountId as HhAccountId })),
  syncStatus: (hhAccountId: string): Promise<NegotiationsSyncStatus> =>
    call((client) => client.NegotiationsSyncStatus({ hhAccountId: hhAccountId as HhAccountId })),
  list: (input: ApplicationListInput): Promise<ReadonlyArray<ApplicationRecord>> =>
    call((client) => client.ApplicationsList({
        ...input,
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        vacancyId: input.vacancyId as VacancyId | undefined
      })),
  get: (id: string): Promise<ApplicationDetail> =>
    call((client) => client.ApplicationsGet({ id: id as ApplicationId })),
  createFromDecision: (input: ApplicationCreateFromDecisionInput): Promise<ApplicationRecord> =>
    call((client) =>
      client.ApplicationsCreateFromDecision({
        decisionId: input.decisionId as DecisionId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId,
        mode: input.mode
      })
    )
}
