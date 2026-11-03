import type {
  EmployerHydrationTarget,
  EmployerId,
  HydrationStats,
  HydrationTarget,
  VacancyId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface HydrationListInput {
  readonly limit?: number
}

export const hydrationApi = {
  stats: (): Promise<HydrationStats> => call((client) => client.HydrationStats()),
  vacancyTargets: (input: HydrationListInput = {}): Promise<ReadonlyArray<HydrationTarget>> =>
    call((client) =>
      client.VacanciesHydrationTargets({ limit: input.limit ?? 25 })
    ),
  employerTargets: (input: HydrationListInput = {}): Promise<ReadonlyArray<EmployerHydrationTarget>> =>
    call((client) =>
      client.EmployersHydrationTargets({ limit: input.limit ?? 25 })
    ),
  hydrateVacancy: (id: string): Promise<{ readonly hydrated: boolean }> =>
    call((client) => client.VacanciesHydrateOne({ id: id as VacancyId })),
  hydrateEmployer: (id: string): Promise<{ readonly hydrated: boolean }> =>
    call((client) => client.EmployersHydrateOne({ id: id as EmployerId }))
}
