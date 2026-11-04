import type { EmployerDetail, EmployerId, EmployerSummary } from "@otbor/contract"
import { call } from "@/shared/api"

export interface CompanyListInput {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
  readonly includeBlacklisted?: boolean
  readonly hhAccountId?: string
  readonly respondedAccountId?: string
}

export interface CompanyListResult {
  readonly items: ReadonlyArray<EmployerSummary>
  readonly total: number
}

export const companyApi = {
  list: (input: CompanyListInput): Promise<CompanyListResult> =>
    call((client) =>
      client.EmployersList({
        query: input.query,
        limit: input.limit,
        offset: input.offset,
        includeBlacklisted: input.includeBlacklisted,
        hhAccountId: input.hhAccountId as any,
        respondedAccountId: input.respondedAccountId as any
      })
    ),
  get: (id: string): Promise<EmployerDetail> =>
    call((client) => client.EmployersGet({ id: id as EmployerId }))
}
