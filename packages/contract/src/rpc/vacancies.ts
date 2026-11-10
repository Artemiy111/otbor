import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { ApplicationState } from "../enums.ts"
import { ApplicationId, HhAccountId, ResumeId, VacancyId } from "../ids.ts"
import { DecisionRecord, PresetFilter, VacancyDetail, VacancySummary } from "../models/index.ts"

export const IngestResult = Schema.Struct({
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  items: Schema.Array(VacancySummary)
})

export type IngestResult = typeof IngestResult.Type

/** Columns the vacancy list can be sorted by on the server. */
export const VacancySortKey = Schema.Literals([
  "title",
  "employer",
  "rating",
  "salary",
  "area",
  "seniority",
  "experience",
  "employment",
  "date",
  "firstSeen",
  "lastSeen",
  "archived",
  "blacklisted",
  "responses",
  "analysed",
  /** Соответствие резюме из текущего решения; вакансии без решения идут в конец. */
  "fit",
  /** Живой приоритет текущего решения; вакансии без решения идут в конец. */
  "priority"
])
export type VacancySortKey = typeof VacancySortKey.Type

export const VacancySort = Schema.Struct({
  key: VacancySortKey,
  direction: Schema.Literals(["asc", "desc"])
})
export type VacancySort = typeof VacancySort.Type

export const VacanciesList = Rpc.make("VacanciesList", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** `true`: only analysed vacancies; `false`: only not analysed; omitted: all. */
    analysed: Schema.optional(Schema.Boolean),
    /** Only vacancies with an active response (submitted, submitting or queued) from this account. */
    respondedAccountId: Schema.optional(HhAccountId),
    /** Case-insensitive substring of the title, employer name or city. */
    search: Schema.optional(Schema.String),
    /** Sort over the whole filtered set, before the page is cut. Default: newest published first. */
    sort: Schema.optional(VacancySort),
    includeArchived: Schema.optional(Schema.Boolean),
    /** Default `false`: blacklist layers hide rows from the default view. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Selects the account whose blacklist layers apply to this page. */
    hhAccountId: Schema.optional(HhAccountId),
    /**
     * Область решений: резюме внутри аккаунта. Без него берётся самое свежее
     * решение аккаунта по вакансии.
     */
    resumeId: Schema.optional(ResumeId),
    /**
     * Фильтр по решению области: `apply` / `draft` / `skip` или `none` (вакансию
     * ещё не оценивали). Без `hhAccountId` область - основной аккаунт пользователя.
     */
    verdict: Schema.optional(Schema.Literals(["apply", "draft", "skip", "none"])),
    /**
     * `yes`: у аккаунта области есть действующий отклик (отправлен, отправляется,
     * в очереди или готовится); `no`: такого отклика нет.
     */
    applied: Schema.optional(Schema.Literals(["yes", "no"])),
    /** ISO-время: только вакансии, впервые увиденные не раньше него (`created_at`). */
    seenSince: Schema.optional(Schema.String),
    /** ISO-время только для счётчика `counts.fresh`; выдачу не сужает. Без него берётся `seenSince`. */
    freshSince: Schema.optional(Schema.String),
    /**
     * Ad-hoc rules, compiled by the same builder as presets. Ad-hoc
     * rules are ANDed with the list's own `includeArchived` / `includeBlacklisted` toggles.
     */
    filter: Schema.optional(PresetFilter)
  }),
  success: Schema.Struct({
    items: Schema.Array(VacancySummary),
    total: Schema.Int,
    /** Аккаунт, для которого посчитаны решения и отклики (явный или основной); null, если аккаунтов нет. */
    scopeHhAccountId: Schema.optional(Schema.NullOr(HhAccountId)),
    /**
     * Счётчики быстрых фильтров по тому же набору, но без `verdict`, `applied`
     * и `seenSince`, чтобы вкладки не менялись от собственного выбора.
     */
    counts: Schema.optional(
      Schema.Struct({
        all: Schema.Int,
        apply: Schema.Int,
        applied: Schema.Int,
        notApplied: Schema.Int,
        /** Только при заданном `seenSince`. */
        fresh: Schema.optional(Schema.Int)
      })
    )
  }),
  error: ApiError
})

export const VacanciesGet = Rpc.make("VacanciesGet", {
  payload: Schema.Struct({ id: VacancyId }),
  success: VacancyDetail,
  error: ApiError
})

export const VacanciesEvaluate = Rpc.make("VacanciesEvaluate", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    /** Fit is computed per resume; when omitted the account default is used. */
    resumeId: Schema.optional(Schema.String),
    fit: Schema.optional(Schema.Int),
    /** Default `false`: a blacklist match is a `blocked_blacklist` skip. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Explicit account; omitted uses the user's default hh account. */
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: DecisionRecord,
  error: ApiError
})

/**
 * What the browser extension paints over an hh.ru page: the stored vacancy,
 * the newest decision and the applications that exist for it.
 */
export const VacancyLookupItem = Schema.Struct({
  externalId: Schema.String,
  vacancy: VacancySummary,
  decision: Schema.NullOr(DecisionRecord),
  applications: Schema.Array(
    Schema.Struct({
      id: ApplicationId,
      hhAccountId: HhAccountId,
      /** The account's label, else the owner's name. */
      hhAccountName: Schema.NullOr(Schema.String),
      hhAccountColor: Schema.NullOr(Schema.String),
      resumeId: Schema.NullOr(Schema.String),
      resumeTitle: Schema.NullOr(Schema.String),
      /** Short code among the account's resumes: first letter, numbered on a clash (D1, D2). */
      resumeCode: Schema.NullOr(Schema.String),
      state: ApplicationState,
      hhStatus: Schema.NullOr(Schema.String)
    })
  )
})

export type VacancyLookupItem = typeof VacancyLookupItem.Type

/** Looks hh vacancies up by external id. Unknown ids are simply absent from the result. */
export const VacanciesLookup = Rpc.make("VacanciesLookup", {
  payload: Schema.Struct({
    externalIds: Schema.Array(Schema.String)
  }),
  success: Schema.Array(VacancyLookupItem),
  error: ApiError
})
