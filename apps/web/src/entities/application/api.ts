import type {
  ApplicationDetail,
  ApplicationId,
  ApplicationRecord,
  DecisionId,
  HhAccountId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface ApplicationListInput {
  readonly state?: string
  readonly limit?: number
}

export interface ApplicationCreateFromDecisionInput {
  readonly decisionId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  readonly mode?: "drafts" | "auto"
}

export const applicationApi = {
  list: (input: ApplicationListInput): Promise<ReadonlyArray<ApplicationRecord>> =>
    call((client) => client.ApplicationsList(input)),
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
