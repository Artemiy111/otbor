import type { PresetFilter } from "@otbor/contract"
import { Effect } from "effect"
import {
  ApplyFilterService,
  type ApplyFilterServiceShape
} from "../../../src/services/ApplyFilterService.ts"
import { LexiconService, type LexiconServiceShape } from "../../../src/services/LexiconService.ts"
import { PresetService } from "../../../src/services/PresetService.ts"
import { runAs, runAsFailure } from "./layers.ts"
import type { Tenant } from "./seeds.ts"

type LexiconListInput = Parameters<LexiconServiceShape["lexiconList"]>[0]

export const lexiconList = async (userId: string, options: LexiconListInput = {}) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const lexicon = yield* LexiconService
      return yield* lexicon.lexiconList(options)
    })
  )

export const lexiconListFailure = async (userId: string, options: LexiconListInput = {}) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const lexicon = yield* LexiconService
      return yield* lexicon.lexiconList(options)
    })
  )

export const applyFilterGet = (
  userId: string,
  input: { readonly hhAccountId: string; readonly resumeId?: string }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const filters = yield* ApplyFilterService
      return yield* filters.get(input)
    })
  )

export const applyFilterSet = (
  userId: string,
  input: Parameters<ApplyFilterServiceShape["set"]>[0]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const filters = yield* ApplyFilterService
      return yield* filters.set(input)
    })
  )

export const applyFilterFromPreset = (
  userId: string,
  input: Parameters<ApplyFilterServiceShape["fromPreset"]>[0]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const filters = yield* ApplyFilterService
      return yield* filters.fromPreset(input)
    })
  )

/**
 * Makes the tenant's account filter permissive (no rules; the implicit
 * archived and blacklist clauses stay), so a test about something else is not
 * decided by the built-in DevOps filter.
 */
/** Nothing is hidden implicitly, so a test filter names what it excludes. */
export const EXCLUDE_ARCHIVED_AND_BLACKLISTED: PresetFilter = {
  rules: [
    { field: "archived", op: "is_false" },
    { field: "hidden", op: "not_in", value: ["app"] }
  ]
}

export const openApplyFilter = (tenant: Tenant, filter: PresetFilter = EXCLUDE_ARCHIVED_AND_BLACKLISTED) =>
  applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter })

export const removePreset = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const presets = yield* PresetService
      return yield* presets.remove(id)
    })
  )

export const presetPreview = (userId: string, filter: PresetFilter) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const presets = yield* PresetService
      return yield* presets.preview(filter)
    })
  )
