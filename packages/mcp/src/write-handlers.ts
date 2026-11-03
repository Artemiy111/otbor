import type {
  ApplicationId,
  DecisionRecord,
  FormAnswer,
  OtborApi,
  ResumeId
} from "@otbor/contract"
import { Effect } from "effect"
import { Api } from "./api.ts"
import { formatIssues, type KitIssue, prevalidateKit } from "./apply.ts"
import { guard } from "./errors.ts"
import { fail, pickResume, resolveOrFetchVacancy, resolveVacancyId } from "./handlers.ts"
import { pickAccount } from "./accounts.ts"
import { accountDirectory, applicationBrief } from "./shapes.ts"
import { OtborWriteToolkit } from "./write-tools.ts"

const DECISION_PAGE = 200
const DECISION_PAGES = 5
/** A record older than this when `application_prepare` returns it was not created by this call. */
const FRESH_MS = 10_000
const DEFAULT_MODEL_LABEL = "claude-chat"

/** Newest decision per vacancy, scanned a page at a time until `match` hits. */
const findDecision = (rpc: OtborApi, match: (decision: DecisionRecord) => boolean) =>
  Effect.gen(function*() {
    for (let page = 0; page < DECISION_PAGES; page++) {
      const batch = yield* rpc.DecisionsList({
        latestPerVacancy: true,
        limit: DECISION_PAGE,
        offset: page * DECISION_PAGE
      })
      const found = batch.find(match)
      if (found !== undefined) return found
      if (batch.length < DECISION_PAGE) break
    }
    return undefined
  })

const problemsMessage = (header: string, lines: ReadonlyArray<string>) =>
  `${header}\n${lines.map((line) => `- ${line}`).join("\n")}`

export const OtborWriteHandlers = OtborWriteToolkit.toLayer(Effect.gen(function*() {
  const api = yield* Api
  const rpc = api.rpc
  const run = guard(api)

  return OtborWriteToolkit.of({
    fit_save: Effect.fn("mcp.fit_save")(function*(params) {
      if (params.fit < 0 || params.fit > 100) return yield* fail("fit must be an integer from 0 to 100")
      if (!(params.confidence >= 0 && params.confidence <= 1)) return yield* fail("confidence must be between 0 and 1")
      const vacancyId = yield* run(resolveVacancyId(rpc, params.vacancyId))
      const saved = yield* run(rpc.FitJudgementSave({
        vacancyId,
        ...(params.resumeId === undefined ? {} : { resumeId: params.resumeId as ResumeId }),
        judgement: {
          fit: params.fit,
          confidence: params.confidence,
          verdict: params.verdict,
          reasons: params.reasons,
          disqualifiers: params.disqualifiers ?? [],
          quotes: params.quotes ?? []
        },
        model: DEFAULT_MODEL_LABEL
      }))
      return {
        vacancyId,
        resumeId: saved.judgement.resumeId,
        judgement: {
          fit: saved.judgement.judgement?.fit ?? null,
          verdict: saved.judgement.judgement?.verdict ?? null,
          status: saved.judgement.status,
          current: saved.judgement.current
        },
        decision: {
          id: saved.decision.id,
          verdict: saved.decision.verdict,
          fit: saved.decision.fit,
          priority: saved.decision.priority,
          gate: saved.decision.gate
        }
      }
    }),

    application_prepare: Effect.fn("mcp.application_prepare")(function*(params) {
      if (params.decisionId === undefined && params.vacancyId === undefined) {
        return yield* fail("pass decisionId (from vacancies_top) or vacancyId")
      }
      const accounts = yield* run(rpc.HhAccountsList())
      const directory = accountDirectory(accounts)
      const hhAccountId = (yield* pickAccount(accounts, params.account ?? params.hhAccountId)).id

      let decision: DecisionRecord | undefined
      if (params.decisionId !== undefined) {
        const wanted = params.decisionId
        decision = yield* run(findDecision(rpc, (d) => d.id === wanted))
      } else {
        const vacancyId = yield* run(resolveVacancyId(rpc, params.vacancyId!))
        decision = yield* run(findDecision(rpc, (d) => d.vacancyId === vacancyId))
        if (decision === undefined) {
          return yield* fail(`no decision for vacancy ${vacancyId}; it has not been evaluated yet (otbor decision evaluate)`)
        }
      }
      const decisionId = params.decisionId ?? decision!.id
      if (decision?.verdict === "skip") {
        return yield* fail(`the decision for "${decision.vacancyTitle ?? decision.vacancyId}" is a skip; there is nothing to apply to`)
      }

      // One application per vacancy per account: hand back the existing one.
      if (decision !== undefined) {
        const known = yield* run(rpc.ApplicationsList({ limit: 200 }))
        const existing = known.find((a) => a.vacancyId === decision!.vacancyId && a.hhAccountId === hhAccountId)
        if (existing !== undefined) {
          return {
            application: applicationBrief(existing, directory),
            existing: true,
            next: existing.state === "submitted"
              ? "already submitted; nothing to do"
              : "already exists; call application_form to see its form and kit"
          }
        }
      }

      const created = yield* run(rpc.ApplicationsCreateFromDecision({
        decisionId,
        hhAccountId,
        mode: "drafts",
        ...(params.resumeId === undefined ? {} : { resumeId: params.resumeId })
      }))
      const existing = Date.now() - Date.parse(created.createdAt) > FRESH_MS
      return {
        application: applicationBrief(created, directory),
        existing,
        next: existing
          ? "already exists; call application_form to see its form and kit"
          : "draft created; the browser harness is opening the form. Poll application_form until prepare.status is \"prepared\""
      }
    }),

    application_prepare_manual: Effect.fn("mcp.application_prepare_manual")(function*(params) {
      const accounts = yield* run(rpc.HhAccountsList())
      const directory = accountDirectory(accounts)
      const account = yield* pickAccount(accounts, params.account)

      const { vacancyId, fetched } = yield* run(resolveOrFetchVacancy(rpc, params.vacancy))
      const resume = yield* run(pickResume(rpc, account.id, params.resumeId))

      const result = yield* run(rpc.ApplicationsCreateManual({
        vacancyId,
        hhAccountId: account.id,
        ...(resume === undefined ? {} : { resumeId: resume.id })
      }))
      const state = result.application.state
      const existing = !result.created
      return {
        application: applicationBrief(result.application, directory),
        existing,
        vacancyFetched: fetched,
        resume: resume === undefined ? null : { id: resume.id, title: resume.title },
        next: !existing
          ? "draft created without a decision; the browser harness is opening the form. Poll application_form until prepare.status is \"prepared\""
          : state === "submitted"
          ? "already submitted for this vacancy and account; nothing to do"
          : state === "skipped"
          ? "an application for this vacancy exists in state skipped and cannot be prepared again from here; tell the user"
          : state === "queued" || state === "submitting"
          ? "the application is already being sent; do not change it, check application_get"
          : "already exists; call application_form to see its form and kit"
      }
    }),

    kit_set: Effect.fn("mcp.kit_set")(function*(params) {
      const applicationId = params.applicationId as ApplicationId
      const detail = yield* run(rpc.ApplicationsGet({ id: applicationId }))
      const state = detail.application.state
      if (state === "submitted" || state === "submitting" || state === "queued") {
        return yield* fail(`the application is ${state}; its kit can no longer be changed`)
      }
      const stored = detail.form ?? null
      if (stored === null) {
        return yield* fail("the form is not prepared yet; poll application_form until prepare.status is \"prepared\"")
      }

      const preIssues: Array<KitIssue> = []
      const seen = new Set<string>()
      for (const answer of params.answers) {
        if (seen.has(answer.questionId)) {
          preIssues.push({ code: "duplicate_answer", questionId: answer.questionId, message: "answered more than once" })
        }
        seen.add(answer.questionId)
      }

      const answers: Array<FormAnswer> = params.answers.map((answer) => ({
        questionId: answer.questionId,
        ...(answer.optionIds === undefined ? {} : { optionIds: answer.optionIds }),
        ...(answer.text === undefined ? {} : { text: answer.text }),
        source: answer.source ?? "model",
        hard: false,
        needsHuman: answer.needsHuman ?? false
      }))

      // A hard hint without blockers is the answer: fill it so the model need not.
      const filledFromHints: Array<string> = []
      for (const hint of stored.hints) {
        if (!hint.hard || hint.blockers.length > 0 || seen.has(hint.questionId)) continue
        if ((hint.optionIds?.length ?? 0) === 0 && (hint.text ?? "").trim() === "") continue
        answers.push({
          questionId: hint.questionId,
          ...(hint.optionIds === undefined ? {} : { optionIds: hint.optionIds }),
          ...(hint.text === undefined ? {} : { text: hint.text }),
          source: "hint",
          hard: true,
          needsHuman: false,
          evidence: hint.evidence
        })
        filledFromHints.push(hint.questionId)
      }

      const letter = params.letter ?? null
      const issues = [...preIssues, ...prevalidateKit(stored, { letter, answers })]
      if (issues.length > 0) {
        return yield* fail(
          problemsMessage(
            `kit NOT saved: ${issues.length} problem(s). Fix all of them and call kit_set again.`,
            formatIssues(issues, stored.form.questions)
          )
        )
      }

      const kit = yield* run(rpc.ApplicationsSetKit({
        applicationId,
        formHash: stored.form.formHash,
        letter,
        answers,
        model: params.model ?? DEFAULT_MODEL_LABEL
      }))
      return {
        saved: true,
        applicationId,
        formHash: kit.formHash,
        letterChars: (kit.letter ?? "").length,
        answered: kit.answers.length,
        filledFromHints,
        next: "Saved. Show the user the letter and answers; call application_approve only after they agree to send."
      }
    }),

    application_approve: Effect.fn("mcp.application_approve")(function*(params) {
      if (params.confirm !== true) {
        return yield* fail("confirm must be true: ask the user before sending a real application")
      }
      const application = yield* run(rpc.ApplicationsApprove({ id: params.applicationId as ApplicationId }))
      const directory = accountDirectory(yield* run(rpc.HhAccountsList()))
      return {
        application: applicationBrief(application, directory),
        queued: application.state === "queued",
        note:
          "The submit is queued and will be sent once by the browser harness. Check progress with application_get " +
          "(queued -> submitting -> submitted). Do not approve again."
      }
    }),

    application_skip: Effect.fn("mcp.application_skip")(function*(params) {
      const application = yield* run(rpc.ApplicationsSkip({
        id: params.applicationId as ApplicationId,
        ...(params.reason === undefined ? {} : { reason: params.reason })
      }))
      const directory = accountDirectory(yield* run(rpc.HhAccountsList()))
      return { application: applicationBrief(application, directory) }
    })
  })
}))
