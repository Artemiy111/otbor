import type { ApiError, EmployerHydrationTarget, HydrationStats } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import * as EmployerRepository from "../repositories/EmployerRepository.ts"
import * as HydrationAttemptRepository from "../repositories/HydrationAttemptRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { toStorageError } from "./support.ts"

export interface HydrationServiceShape {
  /** Counts shown at the top of the hydration page. */
  readonly stats: () => Effect.Effect<HydrationStats, ApiError>
  /** Employers backing vacancies, oldest profile first. */
  readonly employerTargets: (input: { limit?: number | undefined }) => Effect.Effect<
    ReadonlyArray<EmployerHydrationTarget>,
    ApiError
  >
}

export class HydrationService extends Context.Service<HydrationService, HydrationServiceShape>()(
  "otbor/cloud/HydrationService"
) {
  static readonly layer = Layer.effect(
    HydrationService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const stats: HydrationServiceShape["stats"] = () =>
        Effect.gen(function*() {
          const vacancy = yield* database
            .asUser(currentUser.userId, (tx) => VacancyRepository.countHhProfile(tx))
            .pipe(Effect.mapError(toStorageError("hydration.vacancyStats")))
          const employer = yield* database
            .asUser(currentUser.userId, (tx) => EmployerRepository.countHhProfile(tx))
            .pipe(Effect.mapError(toStorageError("hydration.employerStats")))
          const retries = yield* database
            .asOwner((tx) => HydrationAttemptRepository.summary(tx))
            .pipe(Effect.mapError(toStorageError("hydration.attemptStats")))
          return {
            vacancyTotal: vacancy.total,
            vacancyFull: vacancy.full,
            vacancyStub: vacancy.stub,
            employerTotal: employer.total,
            employersLinked: employer.linked,
            employersWithoutRating: employer.withoutRating,
            employersWithoutSite: employer.withoutSite,
            employersWithoutLogo: employer.withoutLogo,
            employersWithoutIndustries: employer.withoutIndustries,
            employersStale30Days: employer.stale30Days,
            deferredVacancies: retries.deferredVacancies,
            deferredEmployers: retries.deferredEmployers,
            poisonedTargets: retries.poisoned,
            nextRetryAt: retries.nextRetryAt
          }
        })

      const employerTargets: HydrationServiceShape["employerTargets"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) =>
            EmployerRepository.listForRefresh(tx, { limit: input.limit }))
          .pipe(Effect.mapError(toStorageError("hydration.employerTargets")))

      return HydrationService.of({ stats, employerTargets })
    })
  )
}
