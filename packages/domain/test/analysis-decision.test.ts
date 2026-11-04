import { describe, expect, test } from "bun:test"
import type { GateVerdict, Seniority } from "@otbor/contract"
import { analysisSeniority, seniorityOfLevel, type DecisionAnalysis } from "../src/analysis/decision.ts"
import { DEFAULT_APPLY_POLICY, decide } from "../src/decision.ts"
import type { VacancySignal } from "../src/decision.ts"

const vacancy = (seniority: Seniority = "unknown"): VacancySignal => ({
  id: "v1",
  title: "Инженер инфраструктуры",
  archived: false,
  salaryFrom: 300_000,
  salaryTo: 400_000,
  salaryCurrency: "RUB",
  workFormats: ["remote"],
  seniority,
  publishedAt: "2026-10-31T12:00:00.000Z",
  employerId: "e1",
  employerName: "Acme",
  skills: [],
  descriptionText: ""
})

const analysis = (overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis => ({
  isIt: { value: true, confidence: 0.98 },
  role: { value: "devops", confidence: 0.97 },
  requiredLevel: null,
  ...overrides
})

const run = (
  verdict: GateVerdict,
  a: DecisionAnalysis | null,
  options: { seniority?: Seniority; policySeniority?: ReadonlyArray<Seniority> } = {}
) =>
  decide({
    vacancy: vacancy(options.seniority),
    gate: {
      verdict,
      roleFamily: "devops",
      rejectedBy: verdict === "reject" ? "продажи" : null,
      rulesVersion: 1,
      weak: []
    },
    keywords: [],
    blocks: { hidden: false, applied: false, employerCooldown: false, hasTest: false, testRequired: false },
    policy: {
      ...DEFAULT_APPLY_POLICY,
      ...(options.policySeniority === undefined ? {} : { seniority: options.policySeniority })
    },
    analysis: a,
    now: new Date("2026-11-01T12:00:00.000Z")
  })

describe("role gate promotion", () => {
  test("an unknown title becomes a match from a confident devops analysis", () => {
    const result = run("unknown", analysis())
    expect(result.verdict).toBe("apply")
    expect(result.gate).toBe("match")
    expect(result.roleFamily).toBe("devops")
    expect(result.reasons.find((r) => r.code === "role_match")?.detail).toBe("analysis (devops 0.97)")
  })

  test("sre and platform promote too, other roles do not", () => {
    expect(run("unknown", analysis({ role: { value: "sre", confidence: 0.9 } })).gate).toBe("match")
    expect(run("unknown", analysis({ role: { value: "platform", confidence: 0.9 } })).gate).toBe("match")
    expect(run("unknown", analysis({ role: { value: "backend", confidence: 0.99 } })).gate).toBe("unknown")
  })

  test("below the threshold or not an IT role stays unknown", () => {
    expect(run("unknown", analysis({ role: { value: "devops", confidence: 0.6 } })).gate).toBe("unknown")
    expect(run("unknown", analysis({ role: null })).gate).toBe("unknown")
    expect(run("unknown", analysis({ isIt: { value: false, confidence: 0.95 } })).gate).toBe("unknown")
    expect(run("unknown", analysis({ isIt: null })).gate).toBe("unknown")
    expect(run("unknown", null).verdict).toBe("skip")
  })

  test("a title reject is final", () => {
    const result = run("reject", analysis())
    expect(result.gate).toBe("reject")
    expect(result.verdict).toBe("skip")
    expect(result.reasons[0]?.code).toBe("role_rejected")
  })

  test("a title match is untouched and carries no analysis reason", () => {
    const result = run("match", analysis())
    expect(result.reasons.find((r) => r.code === "role_match")?.detail).toBe("devops")
  })
})

describe("seniority from the analysis", () => {
  test("maps analysis levels onto the policy seniority", () => {
    expect(seniorityOfLevel("intern")).toBe("junior")
    expect(seniorityOfLevel("junior")).toBe("junior")
    expect(seniorityOfLevel("middle")).toBe("middle")
    expect(seniorityOfLevel("senior")).toBe("senior")
    expect(seniorityOfLevel("staff")).toBe("senior")
    expect(seniorityOfLevel("tech_lead")).toBe("lead")
    expect(seniorityOfLevel("team_lead")).toBe("lead")
    expect(seniorityOfLevel("head")).toBe("lead")
  })

  test("only fills an unknown seniority and only when confident", () => {
    const a = analysis({ requiredLevel: { value: "staff", confidence: 0.9 } })
    expect(analysisSeniority("unknown", a)?.seniority).toBe("senior")
    expect(analysisSeniority("middle", a)).toBeNull()
    expect(analysisSeniority("unknown", analysis({ requiredLevel: { value: "staff", confidence: 0.5 } }))).toBeNull()
    expect(analysisSeniority("unknown", null)).toBeNull()
  })

  test("the policy seniority filter applies to the analysis level, with a reason", () => {
    const junior = analysis({ requiredLevel: { value: "intern", confidence: 0.95 } })
    const blocked = run("match", junior, { policySeniority: ["middle", "senior"] })
    expect(blocked.verdict).toBe("skip")
    expect(blocked.reasons[0]).toMatchObject({ code: "blocked_seniority" })
    expect(blocked.reasons[0]?.detail).toContain("analysis: intern -> junior")

    const passed = run("match", analysis({ requiredLevel: { value: "senior", confidence: 0.95 } }), {
      policySeniority: ["middle", "senior"]
    })
    expect(passed.verdict).toBe("apply")
    expect(passed.reasons.find((r) => r.code === "seniority")?.detail).toBe("analysis: senior -> senior (0.95)")
  })

  test("a stored seniority wins over the analysis", () => {
    const junior = analysis({ requiredLevel: { value: "intern", confidence: 0.95 } })
    const result = run("match", junior, { seniority: "senior", policySeniority: ["senior"] })
    expect(result.verdict).toBe("apply")
    expect(result.reasons.some((r) => r.code === "seniority")).toBe(false)
  })
})
