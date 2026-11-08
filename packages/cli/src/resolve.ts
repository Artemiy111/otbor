import type { ApplicationId, OtborApi, VacancyId } from "@otbor/contract"
import { Effect } from "effect"

/**
 * Ids are UUIDv7 and the first segment is time-ordered, so a prefix is a
 * usable handle in a terminal. Anything ambiguous fails instead of guessing.
 */
/** Полный UUID не ищется в последних 200 записях: он и есть id. */
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const pick = <A extends { readonly id: string }>(
  candidates: ReadonlyArray<A>,
  prefix: string,
  what: string
): A => {
  const matches = candidates.filter((item) => item.id === prefix || item.id.startsWith(prefix))
  const [match] = matches
  if (match === undefined) {
    throw new Error(`No ${what} matches "${prefix}"`)
  }
  if (matches.length > 1) {
    throw new Error(
      `"${prefix}" matches ${matches.length} ${what}s: ${matches.map((item) => item.id.slice(0, 8)).join(", ")}`
    )
  }
  return match
}

export const resolveVacancyId = (
  api: OtborApi,
  prefix: string
): Effect.Effect<VacancyId, Error> =>
  Effect.gen(function*() {
    if (FULL_UUID.test(prefix)) return prefix as VacancyId
    const { items } = yield* api.VacanciesList({ limit: 200 })
    return pick(items, prefix, "vacancy").id
  })

export const resolveApplicationId = (
  api: OtborApi,
  prefix: string
): Effect.Effect<ApplicationId, Error> =>
  Effect.gen(function*() {
    if (FULL_UUID.test(prefix)) return prefix as ApplicationId
    const items = yield* api.ApplicationsList({ limit: 200 })
    return pick(items, prefix, "application").id
  })

export const resolveDecisionId = (api: OtborApi, prefix: string): Effect.Effect<string, Error> =>
  Effect.gen(function*() {
    if (FULL_UUID.test(prefix)) return prefix
    const items = yield* api.DecisionsList({ limit: 200 })
    return pick(items, prefix, "decision").id
  })
