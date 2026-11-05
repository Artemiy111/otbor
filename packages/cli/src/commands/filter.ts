import type { ApplyFilterView, HhAccountId, ResumeId } from "@otbor/contract"
import { describeGroup, describeRule } from "@otbor/domain"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

const accountFlag = Flag.String("account").pipe(
  Flag.withDescription(
    "hh account: id, id prefix or label (defaults to OTBOR_HH_ACCOUNT_ID, the default account, or the only one)"
  ),
  Flag.optional
)

const resumeFlag = Flag.String("resume").pipe(
  Flag.withDescription("Resume id or prefix; without it the account-wide filter is used"),
  Flag.optional
)

const accountLabel = (account: { readonly id: string; readonly label: string }) =>
  `${account.id.slice(0, 8)} (${account.label})`

/** Flag or env, else the default account, else the only one; names and id prefixes are accepted. */
const resolveAccount = (reference: Option.Option<string>) =>
  Effect.gen(function*() {
    const api = yield* Api
    const accounts = yield* api.HhAccountsList()
    const wanted = Option.getOrElse(reference, () => process.env.OTBOR_HH_ACCOUNT_ID ?? "").trim().toLowerCase()
    if (wanted === "") {
      const chosen = accounts.find((account) => account.isDefault) ?? (accounts.length === 1 ? accounts[0] : undefined)
      if (chosen !== undefined) return chosen.id as HhAccountId
      return yield* Effect.fail(
        new Error(
          accounts.length === 0
            ? "No hh account is configured"
            : `Pass --account (several hh accounts, none default): ${accounts.map(accountLabel).join(", ")}`
        )
      )
    }
    const tiers = [
      (a: (typeof accounts)[number]) => a.id.toLowerCase() === wanted,
      (a: (typeof accounts)[number]) => a.label.trim().toLowerCase() === wanted,
      (a: (typeof accounts)[number]) => a.id.toLowerCase().startsWith(wanted)
    ]
    for (const tier of tiers) {
      const matches = accounts.filter(tier)
      if (matches.length === 1) return matches[0]!.id as HhAccountId
      if (matches.length > 1) {
        return yield* Effect.fail(
          new Error(`"${wanted}" matches several accounts: ${matches.map(accountLabel).join(", ")}`)
        )
      }
    }
    return yield* Effect.fail(new Error(`No hh account matches "${wanted}"`))
  })

const resolveResume = (hhAccountId: HhAccountId, reference: Option.Option<string>) =>
  Effect.gen(function*() {
    if (Option.isNone(reference) || reference.value.trim() === "") return undefined
    const api = yield* Api
    const wanted = reference.value.trim().toLowerCase()
    const resumes = yield* api.ResumesList({ hhAccountId })
    const exact = resumes.filter((resume) => resume.id.toLowerCase() === wanted)
    const matches = exact.length > 0 ? exact : resumes.filter((resume) => resume.id.toLowerCase().startsWith(wanted))
    if (matches.length === 0) {
      return yield* Effect.fail(new Error(`No resume of this account matches "${reference.value}"`))
    }
    if (matches.length > 1) {
      return yield* Effect.fail(
        new Error(`"${reference.value}" matches ${matches.length} resumes: ${matches.map((r) => r.id.slice(0, 8)).join(", ")}`)
      )
    }
    return matches[0]!.id as ResumeId
  })

const SOURCE_TEXT: Record<ApplyFilterView["source"], string> = {
  exact: "exact (stored for this resume)",
  account: "account (account-wide row)",
  default: "default (built-in template, nothing stored)"
}

type FilterLike = Pick<ApplyFilterView, "filter" | "minFit" | "tests" | "freshHalfLifeHours" | "templatePresetId">

const printFilter = (view: FilterLike) =>
  Effect.gen(function*() {
    const filter = view.filter
    const rules = filter.rules ?? []
    const groups = filter.groups ?? []
    yield* Console.log(`rules (all must pass): ${rules.length === 0 ? "none" : ""}`.trimEnd())
    for (const rule of rules) yield* Console.log(`  - ${describeRule(rule)}`)
    if (groups.length > 0) {
      yield* Console.log("groups (each ANDed with the rules):")
      for (const group of groups) yield* Console.log(`  - ${describeGroup(group)}`)
    }
    const options: Array<string> = []
    if (filter.text !== undefined && filter.text !== "") options.push(`text: ${filter.text}`)
    if (filter.keywordIds !== undefined && filter.keywordIds.length > 0) {
      options.push(`${filter.keywordIds.length} keywords${filter.location === undefined ? "" : ` in ${filter.location}`}`)
    }
    if (filter.includeArchived === true) options.push("includes archived")
    if (filter.includeBlacklisted === true) options.push("includes blacklisted employers")
    if (options.length > 0) yield* Console.log(`options: ${options.join("; ")}`)
    yield* Console.log("settings:")
    yield* Console.log(`  min fit:         ${view.minFit}`)
    yield* Console.log(`  tests:           ${view.tests}`)
    yield* Console.log(`  half-life hours: ${view.freshHalfLifeHours}`)
    if (view.templatePresetId !== null) yield* Console.log(`  template preset: ${view.templatePresetId}`)
  })

const show = Command.make(
  "show",
  {
    account: accountFlag,
    resume: resumeFlag,
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ account, resume, json }) {
    const api = yield* Api
    const hhAccountId = yield* resolveAccount(account)
    const resumeId = yield* resolveResume(hhAccountId, resume)
    const view = yield* api.ApplyFilterGet({ hhAccountId, resumeId })
    if (json) {
      yield* Console.log(JSON.stringify(view, null, 2))
      return
    }
    yield* Console.log(`account: ${hhAccountId}`)
    yield* Console.log(`resume:  ${view.resumeId ?? "- (account-wide)"}`)
    yield* Console.log(`source:  ${SOURCE_TEXT[view.source]}${view.updatedAt === null ? "" : `, updated ${view.updatedAt}`}`)
    yield* printFilter(view)
  })
).pipe(Command.withDescription("Show the apply filter for an hh account and resume"))

const fromPreset = Command.make(
  "from-preset",
  {
    preset: Argument.String("preset").pipe(Argument.withDescription("Preset id, id prefix or title")),
    account: accountFlag,
    resume: resumeFlag
  },
  Effect.fn(function*({ preset, account, resume }) {
    const api = yield* Api
    const hhAccountId = yield* resolveAccount(account)
    const resumeId = yield* resolveResume(hhAccountId, resume)
    const wanted = preset.trim().toLowerCase()
    const presets = yield* api.PresetsList({})
    const exact = presets.filter((p) => p.id.toLowerCase() === wanted || p.title.trim().toLowerCase() === wanted)
    const matches = exact.length > 0 ? exact : presets.filter((p) => p.id.toLowerCase().startsWith(wanted))
    if (matches.length === 0) return yield* Effect.fail(new Error(`No preset matches "${preset}" (see: otbor preset list)`))
    if (matches.length > 1) {
      return yield* Effect.fail(
        new Error(`"${preset}" matches several presets; use the id: ${matches.map((p) => `${p.id.slice(0, 8)} ${p.kind} ${p.title}`).join(", ")}`)
      )
    }
    const chosen = matches[0]!
    const saved = yield* api.ApplyFilterFromPreset({ hhAccountId, resumeId, presetId: chosen.id })
    yield* Console.log(`copied preset "${chosen.title}" into the filter of ${hhAccountId}${resumeId === undefined ? "" : ` / ${resumeId}`}`)
    yield* printFilter(saved)
  })
).pipe(Command.withDescription("Copy a preset's filter into the apply filter (settings stay)"))

const set = Command.make(
  "set",
  {
    minFit: Flag.Int("min-fit").pipe(Flag.withDescription("Skip vacancies with fit below N (0-100)"), Flag.optional),
    tests: Flag.Literals("tests", ["human", "skip", "allow"]).pipe(
      Flag.withDescription("Employer test policy"),
      Flag.optional
    ),
    halfLife: Flag.Int("half-life-hours").pipe(Flag.withDescription("Freshness half-life in hours"), Flag.optional),
    account: accountFlag,
    resume: resumeFlag
  },
  Effect.fn(function*({ minFit, tests, halfLife, account, resume }) {
    if (Option.isNone(minFit) && Option.isNone(tests) && Option.isNone(halfLife)) {
      return yield* Effect.fail(new Error("Pass at least one of --min-fit, --tests, --half-life-hours"))
    }
    if (Option.isSome(minFit) && (minFit.value < 0 || minFit.value > 100)) {
      return yield* Effect.fail(new Error("--min-fit must be from 0 to 100"))
    }
    if (Option.isSome(halfLife) && halfLife.value < 1) {
      return yield* Effect.fail(new Error("--half-life-hours must be positive"))
    }
    const api = yield* Api
    const hhAccountId = yield* resolveAccount(account)
    const resumeId = yield* resolveResume(hhAccountId, resume)
    // Settings only: keep the rules this pair uses today.
    const current = yield* api.ApplyFilterGet({ hhAccountId, resumeId })
    const saved = yield* api.ApplyFilterSet({
      hhAccountId,
      resumeId,
      filter: current.filter,
      minFit: Option.getOrUndefined(minFit),
      tests: Option.getOrUndefined(tests),
      freshHalfLifeHours: Option.getOrUndefined(halfLife)
    })
    yield* Console.log(`saved the filter of ${hhAccountId}${resumeId === undefined ? "" : ` / ${resumeId}`}`)
    yield* printFilter(saved)
  })
).pipe(Command.withDescription("Change the filter settings (min fit, tests, half-life); rules stay"))

export const filterCommand = Command.make("filter").pipe(
  Command.withSubcommands([show, fromPreset, set]),
  Command.withDescription("Apply filter per hh account and resume")
)
