import { Schema } from "effect"
import { ApplySort, AutoMode, SortDirection, TestsPolicy } from "../enums.ts"
import { ApplyFilterId, HhAccountId, PresetId, ResumeId } from "../ids.ts"
import { PresetFilter, PresetRule, isCompleteRule } from "./presets.ts"

/**
 * The hard blocks of vacancy selection for one (hh account, resume): a
 * {@link PresetFilter} plus the scoring settings kept next to it. `resumeId`
 * null is the account-wide row, the fallback for resumes without their own.
 */
export const ApplyBoost = Schema.Struct({
  rule: PresetRule,
  /** Added to the deterministic fit when the rule holds; -50..50 (checked on save). */
  weight: Schema.Int
})

export type ApplyBoost = typeof ApplyBoost.Type

export const APPLY_BOOST_WEIGHT_MIN = -50
export const APPLY_BOOST_WEIGHT_MAX = 50

/**
 * Parses stored or submitted boosts: malformed entries fail, boosts whose rule
 * is incomplete (empty value) are dropped like in {@link parsePresetFilter}.
 * The weight range is not checked here; `ApplyFilterSet` answers `InvalidInput`.
 */
export const parseBoosts = (input: unknown): ReadonlyArray<ApplyBoost> =>
  Schema.decodeUnknownSync(Schema.Array(ApplyBoost))(input ?? []).filter((boost) =>
    isCompleteRule(boost.rule)
  )

export const ApplyFilterSettings = Schema.Struct({
  /** A vacancy that passes the filter but scores below this fit is skipped. */
  minFit: Schema.Int,
  tests: TestsPolicy,
  freshHalfLifeHours: Schema.Int,
  /** What the auto-apply runner does with this filter; default `off`. */
  autoMode: AutoMode,
  /** Responses per rolling 24 hours per hh account (read from the account row). */
  dailyLimit: Schema.Int,
  /** Vacancies the runner takes per run. */
  batchSize: Schema.Int,
  sort: ApplySort,
  sortDirection: SortDirection,
  /** The runner skips decisions below this priority. Never changes a verdict. */
  minPriority: Schema.Number,
  /** Автоотправка только с сопроводительным письмом. */
  requireLetter: Schema.Boolean,
  /** Scoring rules added to the deterministic fit. */
  boosts: Schema.Array(ApplyBoost),
  /**
   * The ACP agent, model and effort that write the auto-apply letters and
   * answers. Null: the harness default. Steer the writer only; they never
   * change a verdict, so they do not make decisions stale.
   */
  writingHarness: Schema.NullOr(Schema.String),
  writingModel: Schema.NullOr(Schema.String),
  writingEffort: Schema.NullOr(Schema.String)
})

export type ApplyFilterSettings = typeof ApplyFilterSettings.Type

export const ApplyFilterRecord = Schema.Struct({
  id: ApplyFilterId,
  hhAccountId: HhAccountId,
  resumeId: Schema.NullOr(ResumeId),
  filter: PresetFilter,
  minFit: Schema.Int,
  tests: TestsPolicy,
  freshHalfLifeHours: Schema.Int,
  autoMode: AutoMode,
  dailyLimit: Schema.Int,
  batchSize: Schema.Int,
  sort: ApplySort,
  sortDirection: SortDirection,
  minPriority: Schema.Number,
  /** Автоотправка только с сопроводительным письмом. */
  requireLetter: Schema.Boolean,
  boosts: Schema.Array(ApplyBoost),
  writingHarness: Schema.NullOr(Schema.String),
  writingModel: Schema.NullOr(Schema.String),
  writingEffort: Schema.NullOr(Schema.String),
  /** The preset this filter was last copied from; informational, the copy is independent. */
  templatePresetId: Schema.NullOr(PresetId),
  updatedAt: Schema.String
})

export type ApplyFilterRecord = typeof ApplyFilterRecord.Type

/** Which row `ApplyFilterGet` answered from. */
export const ApplyFilterSource = Schema.Literals(["exact", "account", "default"])

export type ApplyFilterSource = typeof ApplyFilterSource.Type

/**
 * What `ApplyFilterGet` returns: the filter that applies to the pair, and
 * where it came from. For `source: "default"` nothing is stored: `id` and
 * `updatedAt` are null and `filter` is the built-in template.
 */
export const ApplyFilterView = Schema.Struct({
  source: ApplyFilterSource,
  id: Schema.NullOr(ApplyFilterId),
  hhAccountId: HhAccountId,
  /** The resume asked for (not the row's); null for an account-level query. */
  resumeId: Schema.NullOr(ResumeId),
  filter: PresetFilter,
  minFit: Schema.Int,
  tests: TestsPolicy,
  freshHalfLifeHours: Schema.Int,
  autoMode: AutoMode,
  dailyLimit: Schema.Int,
  batchSize: Schema.Int,
  sort: ApplySort,
  sortDirection: SortDirection,
  minPriority: Schema.Number,
  /** Автоотправка только с сопроводительным письмом. */
  requireLetter: Schema.Boolean,
  boosts: Schema.Array(ApplyBoost),
  writingHarness: Schema.NullOr(Schema.String),
  writingModel: Schema.NullOr(Schema.String),
  writingEffort: Schema.NullOr(Schema.String),
  templatePresetId: Schema.NullOr(PresetId),
  updatedAt: Schema.NullOr(Schema.String)
})

export type ApplyFilterView = typeof ApplyFilterView.Type

/** The rolling 24-hour response budget of one hh account. */
export const ApplyUsage = Schema.Struct({
  hhAccountId: HhAccountId,
  used: Schema.Int,
  limit: Schema.Int,
  /** `max(0, limit - used)`. */
  remaining: Schema.Int,
  /** Timestamp of the oldest counted response (it frees the first slot 24h later); null when none. */
  oldest: Schema.NullOr(Schema.String)
})

export type ApplyUsage = typeof ApplyUsage.Type
