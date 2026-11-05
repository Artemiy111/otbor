import type {
  AgentCatalog,
  HarnessJob,
  HarnessJobId,
  NegotiationsSyncStatus,
  ApplicationDetail,
  ApplicationId,
  ApplicationRecord,
  DecisionId,
  DraftLetterLength,
  HhAccountId,
  KitAnswer,
  KitRecord,
  VacancyFormState,
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
  /** The response form of a vacancy as last read; never opens hh. */
  formGet: (vacancyId: string): Promise<VacancyFormState> =>
    call((client) => client.VacancyFormGet({ vacancyId: vacancyId as VacancyId })),
  /** Queues a form read when the stored form is stale, or always with `force`. */
  formRefresh: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly force?: boolean
  }): Promise<VacancyFormState> =>
    call((client) =>
      client.VacancyFormRefresh({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        force: input.force
      })
    ),
  /** The exact prompt a generation would send. Read-only. */
  draftPrompt: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
    readonly length?: DraftLetterLength
  }): Promise<{ readonly system: string; readonly user: string; readonly promptVersion: string }> =>
    call((client) =>
      client.DraftPromptPreview({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId,
        length: input.length
      })
    ),
  agentCatalog: (): Promise<AgentCatalog> => call((client) => client.AgentCatalogGet({})),
  draftGenerate: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly resumeId?: string
    readonly length?: DraftLetterLength
    readonly harness: string
    readonly model?: string
    readonly effort?: string
  }): Promise<{ readonly job: HarnessJob }> =>
    call((client) =>
      client.DraftGenerate({
        vacancyId: input.vacancyId as VacancyId,
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: input.resumeId,
        length: input.length,
        harness: input.harness,
        model: input.model,
        effort: input.effort
      })
    ),
  inferenceGet: (id: string): Promise<HarnessJob> =>
    call((client) => client.InferenceGet({ id: id as HarnessJobId })),
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
