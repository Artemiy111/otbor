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
  verdict,
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

const DEVOPS_FILTER = {
  rules: [{ field: "salary", op: "gte", value: 250000, orMissing: true }],
  groups: [{
    branches: [
      { rules: [{ field: "title", op: "contains", value: "devops" }] },
      { rules: [{ field: "title", op: "contains", value: "sre" }] }
    ]
  }]
}

interface Calls {
  create: Array<unknown>
  manual: Array<{ vacancyId: string; hhAccountId: string; resumeId?: string }>
  fetch: Array<{ reference: string }>
  setKit: Array<{ answers: ReadonlyArray<{ questionId: string }>; formHash: string; letter?: string | null }>
  approve: Array<unknown>
  save: Array<unknown>
  filterSet: Array<Record<string, unknown>>
  filterPreset: Array<Record<string, unknown>>
}

const makeFake = (options: {
  applications?: Array<ApplicationRecord>
  detail?: Partial<ApplicationDetail>
  approveError?: unknown
  accounts?: ReadonlyArray<{ id: string; label: string; isDefault: boolean; firstName?: string; lastName?: string }>
  /** Resumes of the account; default: one active resume. */
  resumes?: ReadonlyArray<{ id: string; isActive: boolean }>
  /** Vacancies the corpus already holds by external id; others count as fetched now. */
  known?: ReadonlyArray<string>
  fetchError?: unknown
  /** What ApplicationsCreateManual reports when the application already exists. */
  manualExisting?: ApplicationRecord
}) => {
  const calls: Calls = { create: [], manual: [], fetch: [], setKit: [], approve: [], save: [], filterSet: [], filterPreset: [] }
  const applications = options.applications ?? []
  const rpc = {
    HhAccountsList: () =>
      Effect.succeed(options.accounts ?? [{ id: ACCOUNT, label: "main", isDefault: true }]),
    DecisionsList: () => Effect.succeed([decision(1), decision(2), decision(3, "skip")]),
    VacanciesList: () => Effect.succeed({ items: [] }),
    ApplicationsList: () => Effect.succeed(applications),
    ApplicationsCreateFromDecision: (payload: { decisionId: string }) => {
      calls.create.push(payload)
      const n = Number(payload.decisionId.slice(-4)) - 1000
      return Effect.succeed(record(n, { createdAt: new Date().toISOString() }))
    },
    VacancyFetch: (payload: { reference: string }) => {
      calls.fetch.push(payload)
      if (options.fetchError !== undefined) return Effect.fail(options.fetchError)
      const externalId = /(\d{4,})/.exec(payload.reference)?.[1] ?? "0"
      return Effect.succeed({
        vacancyId: id(7),
        externalId,
        title: "Vacancy 7",
        alreadyKnown: (options.known ?? []).includes(externalId)
      })
    },
    VacanciesGet: (payload: { id: string }) =>
      Effect.succeed({
        vacancy: {
          id: payload.id,
          source: "hh",
          externalId: "9007",
          canonicalUrl: "https://hh.ru/vacancy/9007",
          title: "Vacancy 7",
          employerName: "Employer 7",
          employerId: id(70),
          seniority: "senior",
          workFormats: ["remote"],
          archived: false,
          blacklisted: true,
          blacklistLayers: [],
          createdAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z"
        },
        descriptionText: "Мы ищем разработчика. ".repeat(100),
        skills: ["TypeScript"],
        keywords: []
      }),
    EmployersGet: () =>
      Effect.succeed({
        employer: { id: id(70), name: "Employer 7", industries: [], vacancyCount: 1, blacklisted: false },
        vacancies: []
      }),
    ResumesList: () =>
      Effect.succeed(
        (options.resumes ?? [{ id: id(800), isActive: true }]).map((r) => ({
          id: r.id,
          hhAccountId: ACCOUNT,
          title: "Backend",
          skills: [],
          workFormats: [],
          isActive: r.isActive
        }))
      ),
    ResumeGet: (payload: { id: string }) =>
      Effect.succeed({
        id: payload.id,
        hhAccountId: ACCOUNT,
        title: "Backend developer",
        text: "Опыт: пять лет TypeScript.",
        about: "Люблю надёжные системы",
        skills: ["TypeScript"],
        experience: [{}],
        workFormats: ["remote"],
        isActive: true
      }),
    ResumeEnrichmentGet: () =>
      Effect.succeed({ comment: "Релокация не нужна", experience: [], salaries: [{ currency: "RUB", min: null, expectation: 300000 }], faq: [{ key: "city", answer: "Москва" }], salaryExpectation: 300000, currency: "RUB" }),
    ApplicationsCreateManual: (payload: { vacancyId: string; hhAccountId: string; resumeId?: string }) => {
      calls.manual.push(payload)
      return Effect.succeed(
        options.manualExisting === undefined
          ? { application: record(7, { decisionId: null, state: "draft" }), created: true }
          : { application: options.manualExisting, created: false }
      )
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
    PresetsList: () =>
      Effect.succeed([
        { id: id(900), kind: "apply", title: "DevOps", system: true, filter: DEVOPS_FILTER },
        { id: id(901), kind: "explore", title: "Backend", system: false, filter: {} }
      ]),
    ApplyFilterGet: (payload: { hhAccountId: string; resumeId?: string }) =>
      Effect.succeed({
        source: "default",
        id: null,
        hhAccountId: payload.hhAccountId,
        resumeId: payload.resumeId ?? null,
        filter: DEVOPS_FILTER,
        minFit: 45,
        tests: "human",
        freshHalfLifeHours: 72,
        autoMode: "off",
        dailyLimit: 200,
        batchSize: 20,
        sort: "priority",
        sortDirection: "desc",
        minPriority: 0,
        writingHarness: "claude",
        writingModel: "haiku",
        writingEffort: "low",
        boosts: [{ rule: { field: "salary", op: "gte", value: 250000, currency: "RUB" }, weight: 8 }],
        templatePresetId: null,
        updatedAt: null
      }),
    ApplyUsageGet: (payload: { hhAccountId: string }) =>
      Effect.succeed({ hhAccountId: payload.hhAccountId, used: 12, limit: 200, remaining: 188, oldest: null }),
    ApplyFilterSet: (payload: Record<string, unknown>) => {
      calls.filterSet.push(payload)
      return Effect.succeed({
        id: id(950),
        hhAccountId: payload.hhAccountId,
        resumeId: payload.resumeId ?? null,
        filter: payload.filter,
        minFit: payload.minFit ?? 45,
        tests: payload.tests ?? "human",
        freshHalfLifeHours: payload.freshHalfLifeHours ?? 72,
        autoMode: payload.autoMode ?? "off",
        dailyLimit: payload.dailyLimit ?? 200,
        batchSize: payload.batchSize ?? 20,
        sort: payload.sort ?? "priority",
        sortDirection: payload.sortDirection ?? "desc",
        minPriority: payload.minPriority ?? 0,
        writingHarness: payload.writingHarness ?? null,
        writingModel: payload.writingModel ?? null,
        writingEffort: payload.writingEffort ?? null,
        boosts: [],
        templatePresetId: null,
        updatedAt: "2026-11-05T00:00:00Z"
      })
    },
    ApplyFilterFromPreset: (payload: Record<string, unknown>) => {
      calls.filterPreset.push(payload)
      return Effect.succeed({
        id: id(951),
        hhAccountId: payload.hhAccountId,
        resumeId: payload.resumeId ?? null,
        filter: DEVOPS_FILTER,
        minFit: 45,
        tests: "human",
        freshHalfLifeHours: 72,
        autoMode: "off",
        dailyLimit: 200,
        batchSize: 20,
        sort: "priority",
        sortDirection: "desc",
        minPriority: 0,
        writingHarness: null,
        writingModel: null,
        writingEffort: null,
        boosts: [],
        templatePresetId: payload.presetId,
        updatedAt: "2026-11-05T00:00:00Z"
      })
    },
    FitJudgementSave: (payload: unknown) => {
      calls.save.push(payload)
      return Effect.succeed({
        judgement: { resumeId: id(8), status: "done", current: true, judgement: { fit: 91, verdict: "strong" } },
        decision: { ...decision(1), fit: 91, priority: 99 }
      })
    }
  } as unknown as OtborApi
  return { calls, layer: Layer.succeed(Api, Api.of({ rpc, url: "http://fake/rpc" })) }
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
    const write = ["fit_save", "application_prepare", "application_prepare_manual", "kit_set", "application_approve", "application_skip", "apply_filter_from_preset", "apply_filter_set_settings"]
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

  test("application_prepare resolves the account by name, and refuses to guess among several", async () => {
    const OTHER = id(501)
    const two = [
      { id: ACCOUNT, label: "main", isDefault: false, firstName: "Ivan", lastName: "Petrov" },
      { id: OTHER, label: "side", isDefault: false }
    ]
    const named = makeFake({ accounts: two })
    const ok = await call(named.layer, "application_prepare", { decisionId: id(1001), account: "ivan petrov" })
    expect(ok.isError).toBeFalsy()
    expect(named.calls.create).toEqual([{ decisionId: id(1001), hhAccountId: ACCOUNT, mode: "drafts" }])
    const brief = (ok.structuredContent as { application: { account: { id: string; name: string } } }).application
    expect(brief.account).toEqual({ id: ACCOUNT, name: "Ivan Petrov" })

    const ambiguous = await call(named.layer, "application_prepare", { decisionId: id(1001) })
    expect(ambiguous.isError).toBe(true)
    expect(text(ambiguous)).toContain("none is default")
    expect(text(ambiguous)).toContain("Ivan Petrov")
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

describe("manual mode", () => {
  test("application_prepare_manual fetches an unknown hh URL, bypasses policy and uses the active resume", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "application_prepare_manual", { vacancy: "https://hh.ru/vacancy/9007?query=x" })
    expect(result.isError).toBeFalsy()
    const body = result.structuredContent as {
      existing: boolean
      vacancyFetched: boolean
      resume: { id: string } | null
      application: { state: string; decisionId: string | null }
      next: string
    }
    expect(body).toMatchObject({ existing: false, vacancyFetched: true, application: { state: "draft", decisionId: null } })
    expect(body.resume?.id).toBe(id(800))
    expect(body.next).toContain("application_form")
    expect(calls.fetch).toEqual([{ reference: "https://hh.ru/vacancy/9007?query=x" }])
    expect(calls.manual).toEqual([{ vacancyId: id(7), hhAccountId: ACCOUNT, resumeId: id(800) }])
    // never goes through the decision path
    expect(calls.create).toHaveLength(0)
  })

  test("it is idempotent: an existing application is reported, not recreated", async () => {
    const existing = record(7, { state: "submitted", decisionId: null })
    const { layer, calls } = makeFake({ manualExisting: existing, known: ["9007"] })
    const result = await call(layer, "application_prepare_manual", { vacancy: "9007" })
    const body = result.structuredContent as { existing: boolean; vacancyFetched: boolean; next: string }
    expect(body.existing).toBe(true)
    expect(body.vacancyFetched).toBe(false)
    expect(body.next).toContain("already submitted")
    expect(calls.create).toHaveLength(0)
  })

  test("a UUID names only a stored vacancy and never triggers a fetch", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "application_prepare_manual", { vacancy: id(7) })
    expect(result.isError).toBeFalsy()
    expect(calls.fetch).toHaveLength(0)
    expect(calls.manual[0]?.vacancyId).toBe(id(7))
  })

  test("a failed fetch is a clear error naming the command to run", async () => {
    const { layer, calls } = makeFake({
      fetchError: { _tag: "InvalidInput", message: "fetch https://hh.ru/vacancy/9007: HTTP 403" }
    })
    const result = await call(layer, "application_prepare_manual", { vacancy: "9007" })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("otbor vacancy fetch")
    expect(text(result)).toContain("HTTP 403")
    expect(calls.manual).toHaveLength(0)
  })

  test("account is resolved with the shared resolver and several accounts are not guessed", async () => {
    const OTHER = id(501)
    const two = [
      { id: ACCOUNT, label: "main", isDefault: false },
      { id: OTHER, label: "side", isDefault: false }
    ]
    const { layer, calls } = makeFake({ accounts: two })
    const ambiguous = await call(layer, "application_prepare_manual", { vacancy: id(7) })
    expect(ambiguous.isError).toBe(true)
    expect(text(ambiguous)).toContain("none is default")
    const named = await call(layer, "application_prepare_manual", { vacancy: id(7), account: "side" })
    expect(named.isError).toBeFalsy()
    expect(calls.manual[0]?.hhAccountId).toBe(OTHER)
  })

  test("without an active resume it still prepares, with no resume id", async () => {
    const { layer, calls } = makeFake({ resumes: [{ id: id(801), isActive: false }] })
    const result = await call(layer, "application_prepare_manual", { vacancy: id(7) })
    expect(result.isError).toBeFalsy()
    expect(calls.manual[0]?.resumeId).toBeUndefined()
    expect((result.structuredContent as { resume: unknown }).resume).toBeNull()
  })

  test("cover_letter_context gathers vacancy, resume, rules and warnings in one call", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "cover_letter_context", { vacancy: "https://hh.ru/vacancy/9007", maxChars: 300 })
    expect(result.isError).toBeFalsy()
    const body = result.structuredContent as {
      vacancy: { description: string; truncated: boolean; skills: Array<string>; fetchedNow: boolean }
      employer: { name: string } | null
      resume: { id: string; enrichment: { comment: string } | null } | null
      application: unknown
      styleRules: Array<string>
      warnings: Array<string>
      next: string
    }
    expect(body.vacancy.truncated).toBe(true)
    expect(body.vacancy.description.length).toBeLessThanOrEqual(301)
    expect(body.vacancy.fetchedNow).toBe(true)
    expect(body.vacancy.skills).toEqual(["TypeScript"])
    expect(body.employer?.name).toBe("Employer 7")
    expect(body.resume?.id).toBe(id(800))
    expect(body.resume?.enrichment?.comment).toBe("Релокация не нужна")
    expect(body.resume?.enrichment).toMatchObject({ faq: [{ key: "city", question: "В каком городе вы живёте?", answer: "Москва" }] })
    expect(body.application).toBeNull()
    expect(body.styleRules.join(" ")).toContain("em dash")
    expect(body.warnings.join(" ")).toContain("blacklist")
    expect(body.next).toContain("application_prepare_manual")
    // reading it creates nothing
    expect(calls.manual).toHaveLength(0)
    expect(calls.create).toHaveLength(0)
  })

  test("cover_letter_context shows an existing application with its form state", async () => {
    const existing = record(7, { decisionId: null, state: "draft" })
    const { layer } = makeFake({ applications: [existing], detail: { application: existing } })
    const result = await call(layer, "cover_letter_context", { vacancy: id(7) })
    const body = result.structuredContent as {
      application: { prepare: string; questions: number; kitReadyToApprove: boolean } | null
      next: string
    }
    expect(body.application).toMatchObject({ prepare: "prepared", questions: 3, kitReadyToApprove: false })
    expect(body.next).toContain("application_form")
  })

  test("cover_letter_context warns when the vacancy was already submitted", async () => {
    const existing = record(7, { decisionId: null, state: "submitted" })
    const { layer } = makeFake({ applications: [existing], detail: { application: existing } })
    const result = await call(layer, "cover_letter_context", { vacancy: id(7) })
    const body = result.structuredContent as { warnings: Array<string>; next: string }
    expect(body.warnings.join(" ")).toContain("already submitted")
    expect(body.next).toContain("already submitted")
  })

  test("a test questionnaire is surfaced with its code question and hint blockers; kit_set demands the user", async () => {
    const testForm = {
      ...form,
      form: {
        ...form.form,
        formHash: "hash-test",
        questions: [
          { id: "t1", kind: "text", text: "Ожидания по зарплате", required: true, options: [], maxLength: 100 },
          {
            id: "t2",
            kind: "code",
            text: "Напишите функцию на Python, которая разворачивает строку",
            required: true,
            options: [],
            codeLanguage: "python"
          }
        ]
      },
      hints: [{
        questionId: "t1",
        kind: "salary",
        text: "200 000",
        hard: true,
        confidence: 0.2,
        note: null,
        evidence: [],
        blockers: ["upper_bound_below_minimum"]
      }]
    }
    const { layer, calls } = makeFake({ detail: { form: testForm } as unknown as Partial<ApplicationDetail> })
    const view = (await call(layer, "application_form", { applicationId: id(2001) })).structuredContent as {
      form: {
        questions: Array<{ id: string; kind: string; codeLanguage: string | null; hint: { blockers: Array<string>; hard: boolean } | null }>
      }
    }
    expect(view.form.questions[1]).toMatchObject({ kind: "code", codeLanguage: "python", hint: null })
    expect(view.form.questions[0]?.hint).toMatchObject({ hard: true, blockers: ["upper_bound_below_minimum"] })

    const refused = await call(layer, "kit_set", {
      applicationId: id(2001),
      letter: "Здравствуйте. Коротко о себе.",
      answers: [
        { questionId: "t1", text: "250 000" },
        { questionId: "t2", text: "def f(s): return s[::-1]" }
      ]
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain("code_needs_human")
    expect(text(refused)).toContain("hint_blocked")
    expect(calls.setKit).toHaveLength(0)

    const accepted = await call(layer, "kit_set", {
      applicationId: id(2001),
      letter: "Здравствуйте. Коротко о себе.",
      answers: [
        { questionId: "t1", text: "250 000", source: "human" },
        { questionId: "t2", text: "def f(s): return s[::-1]", source: "human" }
      ]
    })
    expect(accepted.isError).toBeFalsy()
    expect(calls.setKit).toHaveLength(1)
  })

  test("approve is still gated by confirm and the server instructions describe the whole flow", async () => {
    const { layer, calls } = makeFake({})
    const refused = await call(layer, "application_approve", { applicationId: id(2001) })
    expect(refused.isError).toBe(true)
    expect(calls.approve).toHaveLength(0)

    const instructions = serverInstructions(false)
    for (const phrase of [
      "Manual mode",
      "cover_letter_context",
      "application_prepare_manual",
      "application_form",
      "kit_set",
      "application_approve",
      "USER'S OWN answer",
      "explicit"
    ]) {
      expect(instructions).toContain(phrase)
    }
    expect(serverInstructions(true)).not.toContain("application_prepare_manual")
  })

  test("cover_letter_context is a read tool (also in READ-ONLY), prepare_manual is a write tool", async () => {
    const { layer } = makeFake({})
    const { tools } = await withClient(layer, (c) => c.listTools(), registrationFor(true))
    const context = tools.find((t) => t.name === "cover_letter_context")
    expect(context?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === "application_prepare_manual")).toBeUndefined()
  })
})

describe("apply filter", () => {
  test("apply_filter_get shows source, readable rules and settings; it is a read tool", async () => {
    const { layer } = makeFake({})
    const result = await call(layer, "apply_filter_get", {})
    expect(result.isError).toBeFalsy()
    const out = result.structuredContent as {
      source: string
      account: { id: string }
      resumeId: string | null
      rules: Array<string>
      groups: Array<string>
      minFit: number
      tests: string
    }
    expect(out.source).toBe("default")
    expect(out.account.id).toBe(ACCOUNT)
    expect(out.resumeId).toBeNull()
    expect(out.rules).toEqual(["salary >= 250000 (or missing)"])
    expect(out.groups[0]).toContain("title contains devops | title contains sre")
    expect(out.minFit).toBe(45)
    expect(out).toMatchObject({ writingHarness: "claude", writingModel: "haiku", writingEffort: "low" })
    expect(out.tests).toBe("human")
    const auto = result.structuredContent as {
      autoMode: string
      dailyLimit: number
      boosts: Array<string>
      usage: { used: number; limit: number; remaining: number }
    }
    expect(auto.autoMode).toBe("off")
    expect(auto.dailyLimit).toBe(200)
    expect(auto.boosts).toEqual(["salary >= 250000 (RUB) (+8)"])
    expect(auto.usage).toMatchObject({ used: 12, limit: 200, remaining: 188 })

    const { tools } = await withClient(layer, (c) => c.listTools(), registrationFor(true))
    expect(tools.find((t) => t.name === "apply_filter_get")?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === "apply_filter_from_preset")).toBeUndefined()
    expect(tools.find((t) => t.name === "apply_filter_set_settings")).toBeUndefined()
  })

  test("apply_filter_get with a resume asks for that pair", async () => {
    const { layer } = makeFake({})
    const result = await call(layer, "apply_filter_get", { resume: id(800) })
    expect((result.structuredContent as { resumeId: string }).resumeId).toBe(id(800))
    const bad = await call(layer, "apply_filter_get", { resume: id(999) })
    expect(bad.isError).toBe(true)
  })

  test("apply_filter_from_preset resolves a preset by title and copies it", async () => {
    const { layer, calls } = makeFake({})
    const result = await call(layer, "apply_filter_from_preset", { presetId: "devops", resume: id(800) })
    expect(result.isError).toBeFalsy()
    expect(calls.filterPreset).toEqual([{ hhAccountId: ACCOUNT, resumeId: id(800), presetId: id(900) }])
    const out = result.structuredContent as { source: string; templatePresetId: string }
    expect(out.source).toBe("exact")
    expect(out.templatePresetId).toBe(id(900))

    const missing = await call(layer, "apply_filter_from_preset", { presetId: "nope" })
    expect(missing.isError).toBe(true)
    expect(calls.filterPreset).toHaveLength(1)
  })

  test("apply_filter_set_settings keeps the filter, validates and sends only given settings", async () => {
    const { layer, calls } = makeFake({})
    const refusedEmpty = await call(layer, "apply_filter_set_settings", {})
    expect(refusedEmpty.isError).toBe(true)
    const refusedRange = await call(layer, "apply_filter_set_settings", { minFit: 150 })
    expect(refusedRange.isError).toBe(true)
    expect(calls.filterSet).toHaveLength(0)

    const result = await call(layer, "apply_filter_set_settings", { minFit: 60, tests: "skip" })
    expect(result.isError).toBeFalsy()
    expect(calls.filterSet).toEqual([{
      hhAccountId: ACCOUNT,
      filter: DEVOPS_FILTER,
      minFit: 60,
      tests: "skip"
    }])
    const out = result.structuredContent as { minFit: number; tests: string; rules: Array<string>; source: string }
    expect(out.minFit).toBe(60)
    expect(out.tests).toBe("skip")
    expect(out.rules).toHaveLength(1)
    expect(out.source).toBe("account")
  })

  test("apply_filter_set_settings sets auto settings but never 'auto' mode", async () => {
    const { layer, calls } = makeFake({})
    const refusedAuto = await call(layer, "apply_filter_set_settings", { autoMode: "auto" })
    expect(refusedAuto.isError).toBe(true)
    expect(JSON.stringify(refusedAuto.content)).toContain("cannot be enabled through MCP")
    expect((await call(layer, "apply_filter_set_settings", { autoMode: "bogus" })).isError).toBe(true)
    expect((await call(layer, "apply_filter_set_settings", { batchSize: 0 })).isError).toBe(true)
    expect((await call(layer, "apply_filter_set_settings", { batchSize: 501 })).isError).toBe(true)
    expect((await call(layer, "apply_filter_set_settings", { dailyLimit: -1 })).isError).toBe(true)
    expect((await call(layer, "apply_filter_set_settings", { minPriority: -1 })).isError).toBe(true)
    expect((await call(layer, "apply_filter_set_settings", { sortDirection: "sideways" })).isError).toBe(true)
    expect(calls.filterSet).toHaveLength(0)

    const ok = await call(layer, "apply_filter_set_settings", {
      autoMode: "drafts",
      dailyLimit: 50,
      batchSize: 10,
      sort: "fit",
      sortDirection: "asc",
      minPriority: 30
    })
    expect(ok.isError).toBeFalsy()
    expect(calls.filterSet).toEqual([{
      hhAccountId: ACCOUNT,
      filter: DEVOPS_FILTER,
      autoMode: "drafts",
      dailyLimit: 50,
      batchSize: 10,
      sort: "fit",
      sortDirection: "asc",
      minPriority: 30
    }])
    expect((ok.structuredContent as { autoMode: string }).autoMode).toBe("drafts")
    expect((ok.structuredContent as { sortDirection: string }).sortDirection).toBe("asc")

    // The writer settings alone are a valid change; an empty string is passed through to clear.
    const writer = await call(layer, "apply_filter_set_settings", { writingHarness: "claude", writingModel: "" })
    expect(writer.isError).toBeFalsy()
    expect(calls.filterSet[1]).toMatchObject({ writingHarness: "claude", writingModel: "" })
  })

  test("server instructions mention the apply filter and blocked_filter", () => {
    for (const readOnly of [true, false]) {
      const text = serverInstructions(readOnly)
      expect(text).toContain("apply_filter_get")
      expect(text).toContain("blocked_filter")
    }
    expect(serverInstructions(false)).toContain("apply_filter_set_settings")
    expect(serverInstructions(false)).toContain("can NOT be set here")
    expect(serverInstructions(true)).toContain("200 per hh account")
  })
})
