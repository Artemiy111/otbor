import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ProxyMode } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { EmployerId, VacancyId } from "../ids.ts"
import {
  EmployerHydrationTarget,
  HydrationStats,
  HydrationTarget,
  ProxySettingsInput,
  ProxyStatus,
  VacancyDraft
} from "../models/index.ts"
import { IngestResult } from "./vacancies.ts"

export const VacanciesUpsert = Rpc.make("VacanciesUpsert", {
  payload: Schema.Struct({
    drafts: Schema.Array(VacancyDraft)
  }),
  success: IngestResult,
  error: ApiError
})

/** Corpus rows whose search card is still the only description we have. */
export const VacanciesHydrationTargets = Rpc.make("VacanciesHydrationTargets", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    /** Descriptions shorter than this count as stubs. */
    minDescriptionLength: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(HydrationTarget),
  error: ApiError
})

export const VacanciesHydrateOne = Rpc.make("VacanciesHydrateOne", {
  payload: Schema.Struct({
    id: VacancyId,
    /** Defaults to the configured proxy when one is set, direct otherwise. */
    proxyMode: Schema.optional(ProxyMode),
    /** Fetch the page even when the stored text is already complete (re-captures hh signals). */
    force: Schema.optional(Schema.Boolean)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
  error: ApiError
})

/**
 * Manual mode: make sure ONE vacancy is in the corpus. `reference` is an
 * hh.ru vacancy URL or an external id. A known, fully hydrated vacancy is
 * returned as is; otherwise the cloud fetches the public vacancy page through
 * the configured proxy and ingests it (a single GET, never a search).
 */
export const VacancyFetch = Rpc.make("VacancyFetch", {
  payload: Schema.Struct({ reference: Schema.String }),
  success: Schema.Struct({
    vacancyId: VacancyId,
    externalId: Schema.String,
    title: Schema.String,
    /** false when this call fetched and stored the page. */
    alreadyKnown: Schema.Boolean
  }),
  error: ApiError
})

export const VacancyHydrate = Rpc.make("VacancyHydrate", {
  payload: Schema.Struct({
    id: VacancyId,
    proxyMode: Schema.optional(ProxyMode),
    force: Schema.optional(Schema.Boolean)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
  error: ApiError
})

/** Read-only, safe proxy state: no subscription URL or credentials. */
export const ProxyStatusRpc = Rpc.make("ProxyStatus", {
  success: ProxyStatus,
  error: ApiError
})

/** Saves the local proxy file (0600). Env variables still win per field. */
export const ProxyConfigure = Rpc.make("ProxyConfigure", {
  payload: ProxySettingsInput,
  success: ProxyStatus,
  error: ApiError
})

/** Removes the saved proxy file. */
export const ProxyClear = Rpc.make("ProxyClear", {
  success: ProxyStatus,
  error: ApiError
})

/** Overview counters for the vacancy/employer hydration dashboard. */
export const HydrationStatsRpc = Rpc.make("HydrationStats", {
  success: HydrationStats,
  error: ApiError
})

/** Employers backing vacancies, oldest profile first, with gaps made explicit. */
export const EmployersHydrationTargets = Rpc.make("EmployersHydrationTargets", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(EmployerHydrationTarget),
  error: ApiError
})

export const EmployersHydrateOne = Rpc.make("EmployersHydrateOne", {
  payload: Schema.Struct({
    id: EmployerId,
    proxyMode: Schema.optional(ProxyMode)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
  error: ApiError
})
