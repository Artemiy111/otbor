import type { ApplicationDetail, ApplicationRecord, DecisionRecord, OtborApi } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { McpProtocol, McpTest } from "effect/ai"
import { Api } from "../src/api.ts"
import { OtborReadRegistration, OtborToolkitRegistration, registrationFor } from "../src/server.ts"
import { serverInstructions } from "../src/tools.ts"

const id = (n: number) => `0190c8f5-8c2b-7abc-8def-${n.toString().padStart(12, "0")}`
const ACCOUNT = id(500)

const decision = (n: number, verdict = "apply"): DecisionRecord => ({
  id: id(1000 + n),
  userId: "u",
  vacancyId: id(n),
  vacancyTitle: `Vacancy ${n}`,
  roleFamily: "backend",
  verdict,
  gate: "match",
  fit: 80,
  priority: 50,
  reasons: [],
  policyVersion: 1,
  createdAt: "2026-01-01T00:00:00Z"
} as unknown as DecisionRecord)

const record = (n: number, over: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: id(2000 + n),
  userId: "u",
  hhAccountId: ACCOUNT,
  vacancyId: id(n),
  vacancyTitle: `Vacancy ${n}`,
  employerName: `Employer ${n}`,
  resumeId: null,
  decisionId: id(1000 + n),
  state: "draft",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over
} as unknown as ApplicationRecord)

const form = {
  form: {
    vacancyId: "9001",
    layout: "known",
    coverLetter: "optional",
    formHash: "hash-1",
    questions: [
      {
        id: "q1",
        kind: "single",
        text: "Готовы к релокации?",
        required: true,
        options: [{ id: "o1", label: "Да" }, { id: "o2", label: "Нет" }]
      },
      { id: "q2", kind: "text", text: "Почему мы?", required: true, options: [], maxLength: 200 },
      { id: "q3", kind: "text", text: "Ожидания по зарплате", required: false, options: [] }
    ]
  },
  hints: [
    {
      questionId: "q1",
      kind: "relocation",
      optionIds: ["o2"],
      hard: true,
      confidence: 1,
      note: null,
      evidence: ["profile"],
      blockers: []
    }
  ],
  url: "https://hh.ru/applicant/vacancy_response?vacancyId=9001",
  fetchedAt: "2026-01-01T00:00:00Z"
}

interface Calls {
  create: Array<unknown>
  setKit: Array<{ answers: ReadonlyArray<{ questionId: string }>; formHash: string; letter?: string | null }>
  approve: Array<unknown>
  save: Array<unknown>
}

const makeFake = (options: {
  applications?: Array<ApplicationRecord>
  detail?: Partial<ApplicationDetail>
  approveError?: unknown
}) => {
  const calls: Calls = { create: [], setKit: [], approve: [], save: [] }
  const applications = options.applications ?? []
  const rpc = {
    HhAccountsList: () => Effect.succeed([{ id: ACCOUNT, label: "main", isDefault: true }]),
    DecisionsList: () => Effect.succeed([decision(1), decision(2), decision(3, "skip")]),
    VacanciesList: () => Effect.succeed({ items: [] }),
    ApplicationsList: () => Effect.succeed(applications),
    ApplicationsCreateFromDecision: (payload: { decisionId: string }) => {
      calls.create.push(payload)
      const n = Number(payload.decisionId.slice(-4)) - 1000
      return Effect.succeed(record(n, { createdAt: new Date().toISOString() }))
    },
    ApplicationsGet: () =>
      Effect.succeed({
        application: record(1),
        kit: null,
        form,
        attempts: [],
        decision: null,
        ...options.detail
      } as unknown as ApplicationDetail),
    ApplicationsSetKit: (payload: Calls["setKit"][number]) => {
      calls.setKit.push(payload)
      return Effect.succeed({
        id: id(9),
        applicationId: id(2001),
        formHash: payload.formHash,
        letter: payload.letter ?? null,
        answers: payload.answers,
        createdAt: "2026-01-01T00:00:00Z"
      })
    },
    ApplicationsApprove: (payload: unknown) => {
      calls.approve.push(payload)
      return options.approveError === undefined
        ? Effect.succeed(record(1, { state: "queued" }))
        : Effect.fail(options.approveError)
    },
    ApplicationsSkip: () => Effect.succeed(record(1, { state: "skipped" })),
    FitJudgementSave: (payload: unknown) => {
      calls.save.push(payload)
      return Effect.succeed({
        judgement: { resumeId: id(8), status: "done", current: true, judgement: { fit: 91, verdict: "strong" } },
        decision: { ...decision(1), fit: 91, priority: 99 }
      })
    }
  } as unknown as OtborApi
  return { calls, layer: Layer.succeed(Api, { rpc, url: "http://fake/rpc" }) }
}

const withClient = <A>(
  layer: Layer.Layer<Api>,
  use: (client: McpTest.Client) => Effect.Effect<A, unknown>,
  registration: typeof OtborToolkitRegistration = OtborToolkitRegistration
) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const client = yield* McpTest.makeClient(registration.pipe(Layer.provide(layer)), {
        protocols: [McpProtocol.v2025_11_25]
      })
      return yield* use(client)
    }).pipe(Effect.scoped) as Effect.Effect<A, never>
  )

const call = (layer: Layer.Layer<Api>, name: string, args: Record<string, unknown>) =>
  withClient(layer, (c) => c.callTool({ name, arguments: args }))

const text = (result: { content: unknown }) => JSON.stringify(result.content)

describe("write tools", () => {
  test("annotations: write tools are not read-only, only approve is destructive", async () => {
    const { layer } = makeFake({})
    const { tools } = await withClient(layer, (c) => c.listTools())
    const write = ["fit_save", "application_prepare", "kit_set", "application_approve", "application_skip"]
    for (const name of write) {
      const tool = tools.find((t) => t.name === name)
      expect(tool?.annotations?.readOnlyHint).toBe(false)
      expect(tool?.annotations?.destructiveHint).toBe(name === "application_approve")
    }
    expect(tools.find((t) => t.name === "application_form")?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === "vacancies_top")).toBeDefined()
  })

  test("readOnly mode registers only read tools", async () => {
    const { layer } = makeFake({})
    const { tools } = await withClient(layer, (c) => c.listTools(), registrationFor(true))
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.map((t) => t.name)).not.toContain("application_approve")
    expect(tools.map((t) => t.name)).toContain("application_form")
    expect(serverInstructions(true)).toContain("READ-ONLY")
    expect(serverInstructions(false)).toContain("application_approve")
    expect(registrationFor(true)).toBe(OtborReadRegistration)
  })

  test("application_prepare creates once and returns the existing application afterwards", async () => {
    const fresh = makeFake({})
    const first = await call(fresh.layer, "application_prepare", { decisionId: id(1001) })
    expect(first.isError).toBeFalsy()
    const body = first.structuredContent as { existing: boolean; application: { state: string } }
    expect(body.existing).toBe(false)
    expect(body.application.state).toBe("draft")
    expect(fresh.calls.create).toEqual([{ decisionId: id(1001), hhAccountId: ACCOUNT, mode: "drafts" }])

    // an application for vacancy 1 on this account already exists
    const known = makeFake({ applications: [record(1)] })
    const again = await call(known.layer, "application_prepare", { vacancyId: id(1) })
    expect(again.isError).toBeFalsy()
    expect((again.structuredContent as { existing: boolean }).existing).toBe(true)
    const byDecision = await call(known.layer, "application_prepare", { decisionId: id(1001) })
    expect((byDecision.structuredContent as { existing: boolean }).existing).toBe(true)
    expect(known.calls.create).toHaveLength(0)

    // a skip decision is refused before anything is created
    const skip = await call(known.layer, "application_prepare", { vacancyId: id(3) })
    expect(skip.isError).toBe(true)
    expect(text(skip)).toContain("skip")
    expect(known.calls.create).toHaveLength(0)
  })

  test("application_form reports pending, then the form with hints and kit status", async () => {
    const pending = makeFake({ detail: { form: null } })
    const waiting = await call(pending.layer, "application_form", { applicationId: id(2001) })
    const w = waiting.structuredContent as { form: { prepare: { status: string }; questions: Array<unknown> } }
    expect(w.form.prepare.status).toBe("pending")
    expect(w.form.questions).toHaveLength(0)

    const blocked = makeFake({
      detail: {
        form: null,
        attempts: [{
          seq: 1,
          stage: "prepare",
          exit: { tag: "captcha", message: "captcha on hh" },
          startedAt: "t",
          finishedAt: "t"
        }] as unknown as ApplicationDetail["attempts"]
      }
    })
    const b = (await call(blocked.layer, "application_form", { applicationId: id(2001) })).structuredContent as {
      form: { prepare: { status: string; detail: string } }
    }
    expect(b.form.prepare.status).toBe("blocked")
    expect(b.form.prepare.detail).toContain("captcha")

    const ready = makeFake({})
    const r = (await call(ready.layer, "application_form", { applicationId: id(2001) })).structuredContent as {
      form: {
        prepare: { status: string }
        formHash: string
        questions: Array<{ id: string; options: Array<{ id: string }>; hint: { hard: boolean; optionIds: Array<string> } | null }>
        kit: { exists: boolean; readyToApprove: boolean }
      }
    }
    expect(r.form.prepare.status).toBe("prepared")
    expect(r.form.formHash).toBe("hash-1")
    expect(r.form.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"])
    expect(r.form.questions[0]?.hint).toMatchObject({ hard: true, optionIds: ["o2"] })
    expect(r.form.kit).toMatchObject({ exists: false, readyToApprove: false })

    // application_get carries the same compact form
    const got = (await call(ready.layer, "application_get", { id: id(2001) })).structuredContent as {
      form: { questions: Array<unknown> }
    }
    expect(got.form.questions).toHaveLength(3)
  })

  test("kit_set returns every problem at once and saves nothing", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "kit_set", {
      applicationId: id(2001),
      letter: "Здравствуйте! Мне подходит — опыт есть",
      answers: [
        { questionId: "q1", optionIds: ["o1"] }, // overrides the hard hint (o2)
        { questionId: "q9", text: "x" }, // not on the form
        { questionId: "q2", text: "а".repeat(300) } // too long
      ]
    })
    expect(result.isError).toBe(true)
    const message = text(result)
    for (const code of ["hard_hint_overridden", "unknown_question", "text_too_long", "banned_style"]) {
      expect(message).toContain(code)
    }
    expect(calls.setKit).toHaveLength(0)

    const missing = await call(layer, "kit_set", { applicationId: id(2001), letter: "ok", answers: [] })
    expect(text(missing)).toContain("required_unanswered")
    expect(text(missing)).not.toContain("question q1")
  })

  test("kit_set saves a valid kit and fills hard hints", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "kit_set", {
      applicationId: id(2001),
      letter: "Здравствуйте. Мой опыт близок к вашей вакансии.",
      answers: [{ questionId: "q2", text: "Нравится продукт." }]
    })
    expect(result.isError).toBeFalsy()
    const body = result.structuredContent as { saved: boolean; filledFromHints: Array<string>; answered: number }
    expect(body).toMatchObject({ saved: true, filledFromHints: ["q1"], answered: 2 })
    expect(calls.setKit).toHaveLength(1)
    expect(calls.setKit[0]?.formHash).toBe("hash-1")
    expect(calls.setKit[0]?.answers.map((a) => a.questionId).sort()).toEqual(["q1", "q2"])

    const notPrepared = makeFake({ detail: { form: null } })
    const early = await call(notPrepared.layer, "kit_set", { applicationId: id(2001), answers: [] })
    expect(early.isError).toBe(true)
    expect(text(early)).toContain("not prepared")
  })

  test("application_approve needs confirm: true", async () => {
    const { layer, calls } = makeFake({})
    const missing = await call(layer, "application_approve", { applicationId: id(2001) })
    expect(missing.isError).toBe(true)
    const wrong = await call(layer, "application_approve", { applicationId: id(2001), confirm: false })
    expect(wrong.isError).toBe(true)
    expect(calls.approve).toHaveLength(0)

    const ok = await call(layer, "application_approve", { applicationId: id(2001), confirm: true })
    expect(ok.isError).toBeFalsy()
    expect(calls.approve).toEqual([{ id: id(2001) }])
    expect(ok.structuredContent).toMatchObject({ queued: true, application: { state: "queued" } })
  })

  test("application_approve maps LimitExceeded and AnswersInvalid to clear errors", async () => {
    const limited = makeFake({
      approveError: { _tag: "LimitExceeded", limit: 30, used: 30, resetsAt: "2026-01-02T10:00:00.000Z" }
    })
    const l = await call(limited.layer, "application_approve", { applicationId: id(2001), confirm: true })
    expect(l.isError).toBe(true)
    expect(text(l)).toContain("daily apply limit")
    expect(text(l)).toContain("30 of 30")
    expect(text(l)).toContain("2026-01-02T10:00:00.000Z")

    const invalid = makeFake({
      approveError: {
        _tag: "AnswersInvalid",
        applicationId: id(2001),
        message: "x",
        problems: [
          { code: "required_unanswered", questionId: "q2", message: "required question has no answer" },
          { code: "letter_required", questionId: "", message: "the form requires a cover letter" }
        ]
      }
    })
    const i = await call(invalid.layer, "application_approve", { applicationId: id(2001), confirm: true })
    expect(i.isError).toBe(true)
    expect(text(i)).toContain("required_unanswered")
    expect(text(i)).toContain("letter_required")

    const conflict = makeFake({ approveError: { _tag: "Conflict", entity: "Application", message: "already submitted" } })
    const c = await call(conflict.layer, "application_approve", { applicationId: id(2001), confirm: true })
    expect(text(c)).toContain("conflict: already submitted")
  })

  test("fit_save validates ranges locally and returns the new decision", async () => {
    const { layer, calls } = makeFake({})
    const bad = await call(layer, "fit_save", {
      vacancyId: id(1),
      fit: 140,
      confidence: 0.5,
      verdict: "strong",
      reasons: []
    })
    expect(bad.isError).toBe(true)
    expect(calls.save).toHaveLength(0)

    const ok = await call(layer, "fit_save", {
      vacancyId: id(1),
      fit: 91,
      confidence: 0.8,
      verdict: "strong",
      reasons: ["Kubernetes shown"]
    })
    expect(ok.isError).toBeFalsy()
    expect(ok.structuredContent).toMatchObject({ judgement: { fit: 91 }, decision: { priority: 99 } })
    expect(calls.save).toHaveLength(1)
  })

  test("application_skip returns the skipped application", async () => {
    const { layer } = makeFake({})
    const result = await call(layer, "application_skip", { applicationId: id(2001), reason: "not interested" })
    expect(result.structuredContent).toMatchObject({ application: { state: "skipped" } })
  })
})
