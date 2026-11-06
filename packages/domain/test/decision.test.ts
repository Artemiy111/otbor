import { describe, expect, test } from "bun:test"
import { DEFAULT_APPLY_SETTINGS, DEFAULT_BOOSTS } from "../src/applyFilter.ts"
import { decide } from "../src/decision.ts"
import type { DecisionSettings, FilterOutcome, VacancySignal } from "../src/decision.ts"
import { matchLexicon } from "../src/lexicon.ts"
import type { LexiconEntryInput, LexiconMatch } from "../src/lexicon.ts"

const lexicon: ReadonlyArray<LexiconEntryInput> = [
  { id: "k8s", term: "Kubernetes", aliases: [{ id: "k8s-a", alias: "k8s" }] },
  { id: "tf", term: "Terraform", aliases: [] },
  { id: "linux", term: "Linux", aliases: [] }
]

const vacancy = (overrides: Partial<VacancySignal> = {}): VacancySignal => ({
  id: "v1",
  title: "DevOps engineer",
  archived: false,
  salaryFrom: 300_000,
  salaryTo: 400_000,
  salaryCurrency: "RUB",
  workFormats: ["remote"],
  seniority: "senior",
  publishedAt: "2026-10-31T12:00:00.000Z",
  employerId: "e1",
  employerName: "Acme",
  skills: ["Kubernetes", "Terraform"],
  descriptionText: "Kubernetes, Terraform, Linux, CI/CD",
  ...overrides
})

const keywords = (v: VacancySignal): ReadonlyArray<LexiconMatch> =>
  matchLexicon(lexicon, { title: v.title, body: v.descriptionText, skills: v.skills })

const passed = { passed: true, failed: [] as ReadonlyArray<string> }

const settings: DecisionSettings = { ...DEFAULT_APPLY_SETTINGS }

const blocks = {
  applied: false,
  hasTest: false,
  testRequired: false
}

const now = new Date("2026-11-01T12:00:00.000Z")

const run = (
  overrides: Partial<VacancySignal> = {},
  options: {
    filter?: FilterOutcome
    settings?: Partial<DecisionSettings>
    fitOverride?: number
    boostWeight?: number
    blockOverrides?: Partial<typeof blocks>
    now?: Date
  } = {}
) => {
  const v = vacancy(overrides)
  return decide({
    vacancy: v,
    filter: options.filter ?? passed,
    settings: { ...settings, ...options.settings },
    keywords: keywords(v),
    blocks: { ...blocks, ...options.blockOverrides },
    boostWeight: options.boostWeight ?? 0,
    fitOverride: options.fitOverride,
    now: options.now ?? now
  })
}

const sumOf = (weights: ReadonlyArray<{ readonly weight: number }>) =>
  weights.reduce((total, boost) => total + boost.weight, 0)

describe("boosts", () => {
  test("the default boosts add up to the former constants (8 + 5 + 4)", () => {
    expect(DEFAULT_BOOSTS.map((boost) => boost.weight)).toEqual([8, 5, 4])
    expect(sumOf(DEFAULT_BOOSTS)).toBe(17)
    expect(DEFAULT_APPLY_SETTINGS.boosts).toBe(DEFAULT_BOOSTS)
  })

  test("fit is 45 + keyword bonuses + boostWeight, as before with the defaults", () => {
    // title hit (DevOps is not in this lexicon) -> 0; body: kubernetes, terraform, linux -> 3 * 5;
    // skills: kubernetes, terraform -> 2 * 6. Old: 45 + 15 + 12 + 8 + 5 + 4 = 89.
    const withDefaults = run({}, { boostWeight: sumOf(DEFAULT_BOOSTS) })
    const bare = run({}, { boostWeight: 0 })
    expect(withDefaults.fit).toBe(89)
    expect(bare.fit).toBe(72)
  })

  test("a negative total lowers fit, and fit is clamped to 0..100", () => {
    expect(run({}, { boostWeight: -10 }).fit).toBe(62)
    expect(run({}, { boostWeight: 500 }).fit).toBe(100)
    expect(run({}, { boostWeight: -500 }).verdict).toBe("skip")
    expect(run({}, { boostWeight: -500 }).fit).toBe(0)
  })

  test("boosts can push a vacancy below the min fit", () => {
    const result = run({}, { boostWeight: -40 })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_low_fit")
  })

  test("an LLM fit ignores the boosts", () => {
    expect(run({}, { fitOverride: 66, boostWeight: 30 }).fit).toBe(66)
  })
})

describe("decide", () => {
  test("applies to a vacancy that passes the filter", () => {
    const result = run()
    expect(result.verdict).toBe("apply")
    expect(result.fit).toBeGreaterThanOrEqual(DEFAULT_APPLY_SETTINGS.minFit)
    expect(result.priority).toBeGreaterThan(0)
    expect(result.reasons.map((r) => r.code)).toContain("skill_match")
  })

  test("a failing filter is a skip that names the failed rules", () => {
    const result = run({}, {
      filter: { passed: false, failed: ["salary >= 250000", "work_format in remote,hybrid"] }
    })
    expect(result.verdict).toBe("skip")
    expect(result.fit).toBe(0)
    expect(result.priority).toBe(0)
    expect(result.reasons).toEqual([
      { code: "blocked_filter", detail: "salary >= 250000, work_format in remote,hybrid" }
    ])
  })

  test("already applied is reported even when the filter fails too", () => {
    const result = run({}, {
      filter: { passed: false, failed: ["not archived"] },
      blockOverrides: { applied: true }
    })
    expect(result.reasons[0]!.code).toBe("blocked_applied")
  })

  test("already applied is a block", () => {
    const result = run({}, { blockOverrides: { applied: true } })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_applied")
  })

  test("a mandatory test blocks the human policy, an optional one does not", () => {
    const mandatory = run({}, { blockOverrides: { hasTest: true, testRequired: true } })
    expect(mandatory.reasons[0]!.code).toBe("blocked_test")

    const optional = run({}, { blockOverrides: { hasTest: true, testRequired: false } })
    expect(optional.verdict).toBe("apply")

    const allowAll = run(
      {},
      { blockOverrides: { hasTest: true, testRequired: true }, settings: { tests: "allow" } }
    )
    expect(allowAll.verdict).toBe("apply")

    const skipAll = run(
      {},
      { blockOverrides: { hasTest: true, testRequired: false }, settings: { tests: "skip" } }
    )
    expect(skipAll.reasons[0]!.code).toBe("blocked_test")
  })

  test("low fit blocks, by the settings floor", () => {
    const result = run({}, { fitOverride: 20 })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_low_fit")
    expect(result.fit).toBe(20)

    expect(run({}, { fitOverride: 20, settings: { minFit: 10 } }).verdict).toBe("apply")
  })

  test("an LLM fit override is clamped", () => {
    expect(run({}, { fitOverride: 140 }).fit).toBe(100)
    expect(run({}, { fitOverride: -5 }).fit).toBe(0)
  })

  test("the fit reason says where the number came from", () => {
    const detail = (result: ReturnType<typeof run>) =>
      result.reasons.find((reason) => reason.code === "fit")?.detail
    expect(detail(run({}, { fitOverride: 66 }))).toBe("llm 66")
    expect(detail(run({}))).toMatch(/^deterministic \d+$/)
  })

  test("fresher vacancies rank higher", () => {
    const fresh = run({ publishedAt: "2026-11-01T10:00:00.000Z" })
    const old = run({ publishedAt: "2026-10-20T10:00:00.000Z" })
    expect(fresh.verdict).toBe("apply")
    expect(old.verdict).toBe("apply")
    expect(fresh.priority).toBeGreaterThan(old.priority)
  })

  test("the freshness half-life comes from the settings", () => {
    const slow = run({ publishedAt: "2026-10-30T12:00:00.000Z" }, { settings: { freshHalfLifeHours: 720 } })
    const fast = run({ publishedAt: "2026-10-30T12:00:00.000Z" }, { settings: { freshHalfLifeHours: 24 } })
    expect(slow.priority).toBeGreaterThan(fast.priority)
  })

  test("unknown publication date gets a neutral freshness", () => {
    const result = run({ publishedAt: null })
    expect(result.verdict).toBe("apply")
    expect(result.reasons.find((r) => r.code === "freshness")?.detail).toBeUndefined()
  })
})
