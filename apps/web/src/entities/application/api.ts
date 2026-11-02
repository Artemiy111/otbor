import type { ApplicationDetail, ApplicationRecord, ApplicationId } from "@otbor/contract"
import { call } from "@/shared/api"

export interface ApplicationListInput {
  readonly state?: string
  readonly limit?: number
}

export const applicationApi = {
  list: (input: ApplicationListInput): Promise<ReadonlyArray<ApplicationRecord>> =>
    call((client) => client.ApplicationsList(input)),
  get: (id: string): Promise<ApplicationDetail> =>
    call((client) => client.ApplicationsGet({ id: id as ApplicationId }))
}
