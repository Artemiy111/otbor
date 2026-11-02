import type { EmployerDetail, EmployerId, EmployerSummary } from "@otbor/contract"
import { call } from "@/shared/api"

export interface CompanyListInput {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export interface CompanyListResult {
  readonly items: ReadonlyArray<EmployerSummary>
  readonly total: number
}

export const companyApi = {
  list: (input: CompanyListInput): Promise<CompanyListResult> =>
    call((client) => client.EmployersList(input)),
  get: (id: string): Promise<EmployerDetail> =>
    call((client) => client.EmployersGet({ id: id as EmployerId }))
}
