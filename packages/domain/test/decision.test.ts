import { describe, expect, test } from "bun:test"
import type { GateVerdict, Seniority, WorkFormat } from "@otbor/contract"
import { DEFAULT_APPLY_POLICY, decide } from "../src/decision.ts"
import type { ApplyPolicy, VacancySignal } from "../src/decision.ts"
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

const gate = (verdict: GateVerdict = "match") => ({
  verdict,
  roleFamily: "devops" as const,
  rejectedBy: verdict === "reject" ? "продажи" : null,
  rulesVersion: 1,
  weak: verdict === "unknown" ? ["облачные решения"] : []
})

const blocks = {
  hidden: false,
  applied: false,
  employerCooldown: false,
  hasTest: false,
  testRequired: false
}

const now = new Date("2026-11-01T12:00:00.000Z")

const run = (
  overrides: Partial<VacancySignal> = {},
  options: {
    gateVerdict?: GateVerdict
    policy?: Partial<ApplyPolicy>
    fitOverride?: number
    blockOverrides?: Partial<typeof blocks>
    now?: Date
  } = {}
) => {
  const v = vacancy(overrides)
  return decide({
    vacancy: v,
    gate: gate(options.gateVerdict),
    keywords: keywords(v),
    blocks: { ...blocks, ...options.blockOverrides },
    policy: { ...DEFAULT_APPLY_POLICY, ...options.policy },
    fitOverride: options.fitOverride,
    now: options.now ?? now
  })
}

describe("decide", () => {
  test("applies to a strong DevOps vacancy", () => {
    const result = run()
    expect(result.verdict).toBe("apply")
    expect(result.gate).toBe("match")
    expect(result.fit).toBeGreaterThanOrEqual(DEFAULT_APPLY_POLICY.minFit)
    expect(result.priority).toBeGreaterThan(0)
    expect(result.reasons.map((r) => r.code)).toContain("role_match")
    expect(result.reasons.map((r) => r.code)).toContain("skill_match")
    expect(result.reasons.map((r) => r.code)).toContain("salary")
    expect(result.reasons.map((r) => r.code)).toContain("remote")
  })

  test("archived is a hard block", () => {
    const result = run({ archived: true })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_archived")
    expect(result.priority).toBe(0)
  })

  test("hidden and already applied are hard blocks", () => {
    expect(run({}, { blockOverrides: { hidden: true } }).reasons[0]!.code).toBe("blocked_hidden")
    expect(run({}, { blockOverrides: { applied: true } }).reasons[0]!.code).toBe("blocked_applied")
  })

  test("already applied can be allowed by policy", () => {
    const result = run({}, { blockOverrides: { applied: true }, policy: { excludeApplied: false } })
    expect(result.verdict).toBe("apply")
  })

  test("a known upper salary bound below the floor blocks", () => {
    const result = run({ salaryFrom: 100_000, salaryTo: 150_000 })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_salary")
  })

  test("an open-ended salary from below the floor does not block", () => {
    const result = run({ salaryFrom: 100_000, salaryTo: null })
    expect(result.verdict).toBe("apply")
  })

  test("office-only vacancies are blocked by a remote policy", () => {
    const result = run({ workFormats: ["office"] })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_work_format")
  })

  test("unknown work format is not a block", () => {
    expect(run({ workFormats: [] }).verdict).toBe("apply")
    expect(run({ workFormats: ["unknown"] }).verdict).toBe("apply")
  })

  test("a mandatory test blocks the human policy, an optional one does not", () => {
    const mandatory = run({}, { blockOverrides: { hasTest: true, testRequired: true } })
    expect(mandatory.reasons[0]!.code).toBe("blocked_test")

    const optional = run({}, { blockOverrides: { hasTest: true, testRequired: false } })
    expect(optional.verdict).toBe("apply")

    const allowAll = run(
      {},
      { blockOverrides: { hasTest: true, testRequired: true }, policy: { tests: "allow" } }
    )
    expect(allowAll.verdict).toBe("apply")
  })

  test("a rejected title never applies, even with a perfect body", () => {
    const result = run({}, { gateVerdict: "reject" })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("role_rejected")
  })

  test("an unknown title is a quiet skip, not a draft", () => {
    const result = run({}, { gateVerdict: "unknown" })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("role_unknown")
  })

  test("low fit blocks", () => {
    const result = run({}, { fitOverride: 20 })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_low_fit")
    expect(result.fit).toBe(20)
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

  test("a title keyword requirement is enforced on the title only", () => {
    const result = run(
      { title: "DevOps engineer" },
      { policy: { titleKeywords: ["kubernetes"] } }
    )
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_keywords")
    expect(result.reasons[0]!.detail).toContain("title")
  })

  test("a body keyword requirement is satisfied by the body", () => {
    const result = run({}, { policy: { bodyKeywords: ["terraform"] } })
    expect(result.verdict).toBe("apply")
  })

  test("excluded keywords block", () => {
    const result = run({}, { policy: { excludeKeywords: ["terraform"] } })
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_keywords")
    expect(result.reasons[0]!.detail).toContain("terraform")
  })

  test("seniority outside the policy blocks", () => {
    const result = run(
      { seniority: "middle" satisfies Seniority },
      { policy: { seniority: ["senior", "lead"] } }
    )
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]!.code).toBe("blocked_seniority")
  })

  test("fresher vacancies rank higher", () => {
    const fresh = run({ publishedAt: "2026-11-01T10:00:00.000Z" })
    const old = run({ publishedAt: "2026-10-20T10:00:00.000Z" })
    expect(fresh.verdict).toBe("apply")
    expect(old.verdict).toBe("apply")
    expect(fresh.priority).toBeGreaterThan(old.priority)
  })

  test("unknown publication date gets a neutral freshness", () => {
    const result = run({ publishedAt: null })
    expect(result.verdict).toBe("apply")
    expect(result.reasons.find((r) => r.code === "freshness")?.detail).toBe("unknown")
  })

  test("a work format list is compared by intersection", () => {
    const hybrid = run(
      { workFormats: ["hybrid"] satisfies WorkFormat[] },
      { policy: { workFormats: ["remote"] } }
    )
    expect(hybrid.verdict).toBe("skip")
  })
})
