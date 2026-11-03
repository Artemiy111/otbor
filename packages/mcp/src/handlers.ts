import type {
  ApplicationId,
  ContactId,
  ConversationId,
  DecisionRecord,
  EmployerId,
  HhAccountId,
  OtborApi,
  PresetId,
  ResumeId,
  VacancyId
} from "@otbor/contract"
import { describeKitAnswer } from "@otbor/contract"
import { Effect } from "effect"
import { Api } from "./api.ts"
import { guard, ToolFailure } from "./errors.ts"
import {
  applicationBrief,
  clamp,
  decisionBrief,
  employerBrief,
  formatSalary,
  humanReasons,
  truncate,
  vacancyBrief
} from "./shapes.ts"
import { formView } from "./apply.ts"
import { OtborReadToolkit, type TopItem } from "./tools.ts"

const DECISION_PAGE = 200
const DECISION_PAGES = 4
const VACANCY_PAGE = 200
const VACANCY_PAGES = 5

export const fail = (message: string) => Effect.fail(new ToolFailure({ message }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Newest-first decisions, `pages` pages of 200. Stops early on a short page. */
const scanDecisions = (rpc: OtborApi, verdict: string | undefined, pages = DECISION_PAGES) =>
  Effect.gen(function*() {
    const all: Array<DecisionRecord> = []
    for (let page = 0; page < pages; page++) {
      const batch = yield* rpc.DecisionsList({ verdict, limit: DECISION_PAGE, offset: page * DECISION_PAGE })
      all.push(...batch)
      if (batch.length < DECISION_PAGE) break
    }
    return all
  })

/** One decision per vacancy: the newest wins because the scan is newest-first. */
const latestPerVacancy = (decisions: ReadonlyArray<DecisionRecord>) => {
  const byVacancy = new Map<string, DecisionRecord>()
  for (const decision of decisions) {
    if (!byVacancy.has(decision.vacancyId)) byVacancy.set(decision.vacancyId, decision)
  }
  return [...byVacancy.values()]
}

/** Accepts a UUID, a UUID prefix, an hh.ru URL or an hh external id. */
export const resolveVacancyId = (rpc: OtborApi, reference: string) =>
  Effect.gen(function*() {
    const ref = reference.trim()
    if (UUID.test(ref)) return ref as VacancyId

    const externalId = /vacancy\/(\d+)/.exec(ref)?.[1] ?? (/^\d+$/.test(ref) ? ref : undefined)
    const prefix = externalId === undefined && /^[0-9a-f-]{4,}$/i.test(ref) ? ref.toLowerCase() : undefined
    if (externalId === undefined && prefix === undefined) {
      return yield* fail(`cannot interpret "${ref}" as a vacancy id, id prefix, hh.ru URL or external id`)
    }

    for (let page = 0; page < VACANCY_PAGES; page++) {
      const { items } = yield* rpc.VacanciesList({
        limit: VACANCY_PAGE,
        offset: page * VACANCY_PAGE,
        includeArchived: true,
        includeBlacklisted: true
      })
      const matches = items.filter((v) =>
        externalId !== undefined ? v.externalId === externalId : v.id.startsWith(prefix!)
      )
      if (matches.length > 1) {
        return yield* fail(`"${ref}" matches ${matches.length} vacancies; use a longer id prefix`)
      }
      if (matches[0] !== undefined) return matches[0].id
      if (items.length < VACANCY_PAGE) break
    }
    return yield* fail(`no vacancy matches "${ref}" among the ${VACANCY_PAGES * VACANCY_PAGE} most recent`)
  })

const money = (amount: number | null | undefined, currency: string | null | undefined) =>
  amount == null ? null : `${amount}${currency ? ` ${currency}` : ""}`

export const OtborReadHandlers = OtborReadToolkit.toLayer(Effect.gen(function*() {
  const api = yield* Api
  const rpc = api.rpc
  const run = guard(api)

  return OtborReadToolkit.of({
    system_health: Effect.fn("mcp.system_health")(function*() {
      const health = yield* run(rpc.SystemHealth())
      const { accounts = [], ...rest } = health
      return {
        ...rest,
        apiUrl: api.url,
        accounts: accounts.map((a) => ({
          id: a.id,
          label: a.label,
          profile: a.sessionProfile,
          sessionState: a.session?.state ?? null,
          lastOkAt: a.session?.lastOkAt ?? null,
          lastError: a.session?.lastError ?? null
        }))
      }
    }),

    fit_get: Effect.fn("mcp.fit_get")(function*({ id, resumeId }) {
      const vacancyId = yield* run(resolveVacancyId(rpc, id))
      const record = yield* run(
        rpc.FitJudgementGet({
          vacancyId,
          ...(resumeId === undefined ? {} : { resumeId: resumeId as ResumeId })
        })
      )
      return {
        vacancyId,
        judgement: record === null
          ? null
          : {
              status: record.status,
              current: record.current,
              source: record.source,
              model: record.model,
              resumeId: record.resumeId,
              promptVersion: record.promptVersion,
              fit: record.judgement?.fit ?? null,
              confidence: record.judgement?.confidence ?? null,
              verdict: record.judgement?.verdict ?? null,
              reasons: record.judgement?.reasons ?? [],
              disqualifiers: record.judgement?.disqualifiers ?? [],
              quotes: record.judgement?.quotes ?? [],
              error: record.error,
              updatedAt: record.updatedAt
            }
      }
    }),

    queue_stats: Effect.fn("mcp.queue_stats")(function*() {
      return yield* run(rpc.QueueStatsGet())
    }),

    schedules_list: Effect.fn("mcp.schedules_list")(function*() {
      const schedules = yield* run(rpc.SchedulesList())
      return {
        items: schedules.map((s) => ({
          id: s.id,
          kind: s.kind,
          target: s.targetId,
          intervalMinutes: s.intervalMinutes,
          enabled: s.enabled,
          nextRunAt: s.nextRunAt,
          lastRunAt: s.lastRunAt,
          lastError: s.lastError
        }))
      }
    }),

    vacancies_top: Effect.fn("mcp.vacancies_top")(function*(params) {
      const count = clamp(params.limit, 10, 50)
      const verdict = params.verdict ?? "apply"

      let presetId: string | undefined
      if (params.presetId !== undefined) {
        const wanted = params.presetId.toLowerCase()
        const presets = yield* run(rpc.PresetsList({}))
        const preset = presets.find((p) => p.id === wanted || p.id.startsWith(wanted))
        if (preset === undefined) return yield* fail(`preset not found: ${params.presetId}`)
        presetId = preset.id
      }

      // Ranking happens in the database: best priority first, newest decision
      // per vacancy only, preset and fit filters applied before the limit.
      const ranked = yield* run(rpc.DecisionsList({
        verdict,
        orderBy: "priority",
        latestPerVacancy: true,
        limit: count,
        ...(params.minFit === undefined ? {} : { minFit: Math.trunc(params.minFit) }),
        ...(presetId === undefined ? {} : { presetId: presetId as PresetId })
      }))
      const notes: Array<string> = []

      const details = yield* Effect.forEach(
        ranked,
        (d) =>
          run(rpc.VacanciesGet({ id: d.vacancyId })).pipe(
            Effect.map((detail) => detail.vacancy),
            Effect.catch(() => Effect.succeed(undefined))
          ),
        { concurrency: 5 }
      )

      const items: Array<TopItem> = ranked.map((d, index) => {
        const v = details[index]
        return {
          rank: index + 1,
          decisionId: d.id,
          vacancyId: d.vacancyId,
          title: v?.title ?? d.vacancyTitle ?? "(unknown title)",
          employer: v?.employerName ?? null,
          salary: v ? formatSalary(v.salaryFrom, v.salaryTo, v.salaryCurrency) : null,
          workFormats: v?.workFormats ?? [],
          fit: d.fit,
          priority: d.priority,
          verdict: d.verdict,
          gate: d.gate,
          reasons: humanReasons(d.reasons, 4),
          url: v?.canonicalUrl ?? null
        }
      })

      return {
        items,
        returned: items.length,
        considered: items.length,
        note: notes.length === 0 ? null : notes.join("; ")
      }
    }),

    vacancy_get: Effect.fn("mcp.vacancy_get")(function*(params) {
      const maxChars = clamp(params.maxChars, 4000, 20000, 200)
      const id = yield* run(resolveVacancyId(rpc, params.id))
      const detail = yield* run(rpc.VacanciesGet({ id }))
      const decisions = yield* run(scanDecisions(rpc, undefined)).pipe(Effect.catch(() => Effect.succeed([])))
      const latest = decisions.find((d) => d.vacancyId === id)
      const description = truncate(detail.descriptionText, maxChars)
      const v = detail.vacancy
      return {
        vacancy: vacancyBrief(v),
        experience: v.experienceCode ?? null,
        employmentForm: v.employmentForm ?? null,
        description: description.text,
        descriptionLength: detail.descriptionText.length,
        truncated: description.truncated,
        skills: detail.skills,
        keywords: detail.keywords.map((k) => ({
          term: k.term,
          matchedForm: k.matchedForm,
          inTitle: k.inTitle,
          inBody: k.inBody,
          inSkills: k.inSkills,
          bodyCount: k.bodyCount,
          typo: k.typo
        })),
        titleGate: detail.titleVerdict ?? null,
        decision: latest === undefined ? null : decisionBrief(latest, 8)
      }
    }),

    decisions_list: Effect.fn("mcp.decisions_list")(function*(params) {
      const decisions = yield* run(rpc.DecisionsList({
        verdict: params.verdict,
        limit: clamp(params.limit, 20, 100),
        offset: clamp(params.offset, 0, 100000, 0)
      }))
      const items = decisions
        .filter((d) => params.minFit === undefined || d.fit >= params.minFit)
        .map((d) => decisionBrief(d))
      return { items, returned: items.length }
    }),

    presets_list: Effect.fn("mcp.presets_list")(function*(params) {
      const presets = yield* run(rpc.PresetsList({ kind: params.kind }))
      return {
        items: presets.map((p) => ({ id: p.id, kind: p.kind, title: p.title, system: p.system, filter: p.filter }))
      }
    }),

    preset_preview: Effect.fn("mcp.preset_preview")(function*(params) {
      const wanted = params.presetId.toLowerCase()
      const presets = yield* run(rpc.PresetsList({}))
      const preset = presets.find((p) => p.id === wanted || p.id.startsWith(wanted))
      if (preset === undefined) return yield* fail(`preset not found: ${params.presetId}`)
      const preview = yield* run(rpc.PresetsPreview({ filter: preset.filter }))
      return {
        preset: { id: preset.id, title: preset.title, kind: preset.kind },
        count: preview.count,
        keywords: preview.keywords,
        skills: preview.skills,
        companies: preview.companies,
        vacancies: preview.vacancies.slice(0, clamp(params.limit, 10, 50)).map(vacancyBrief)
      }
    }),

    employers_list: Effect.fn("mcp.employers_list")(function*(params) {
      const { items, total } = yield* run(rpc.EmployersList({
        query: params.query,
        includeBlacklisted: params.includeBlacklisted,
        limit: clamp(params.limit, 20, 100),
        offset: clamp(params.offset, 0, 100000, 0)
      }))
      return { items: items.map(employerBrief), total }
    }),

    employer_get: Effect.fn("mcp.employer_get")(function*(params) {
      const detail = yield* run(rpc.EmployersGet({ id: params.id as EmployerId }))
      const max = clamp(params.vacanciesLimit, 10, 50)
      return {
        employer: employerBrief(detail.employer),
        vacancies: detail.vacancies.slice(0, max).map(vacancyBrief),
        vacanciesTotal: detail.vacancies.length
      }
    }),

    resumes_list: Effect.fn("mcp.resumes_list")(function*(params) {
      const resumes = yield* run(rpc.ResumesList({ hhAccountId: params.hhAccountId as HhAccountId | undefined }))
      return {
        items: resumes.map((r) => ({
          id: r.id,
          hhAccountId: r.hhAccountId,
          title: r.title,
          salary: money(r.salaryAmount, r.salaryCurrency),
          status: r.status ?? null,
          isActive: r.isActive,
          skills: r.skills,
          workFormats: r.workFormats
        }))
      }
    }),

    resume_get: Effect.fn("mcp.resume_get")(function*(params) {
      const maxChars = clamp(params.maxChars, 3000, 20000, 200)
      const id = params.id as ResumeId
      const resume = yield* run(rpc.ResumeGet({ id }))
      const enrichment = yield* run(rpc.ResumeEnrichmentGet({ resumeId: id })).pipe(
        Effect.catch(() => Effect.succeed(null))
      )
      const text = truncate(resume.text, maxChars)
      const about = truncate(resume.about, maxChars)
      return {
        id: resume.id,
        hhAccountId: resume.hhAccountId,
        title: resume.title,
        skills: resume.skills,
        workFormats: resume.workFormats,
        salary: money(resume.salaryAmount, resume.salaryCurrency),
        status: resume.status ?? null,
        isActive: resume.isActive,
        experienceEntries: resume.experience.length,
        about: about.text,
        text: text.text,
        truncated: text.truncated || about.truncated,
        enrichment: enrichment === null
          ? null
          : {
            comment: enrichment.comment,
            salaryMin: enrichment.salaryMin ?? null,
            salaryExpectation: enrichment.salaryExpectation ?? null,
            currency: enrichment.currency ?? null,
            experience: enrichment.experience.map((e) => ({
              key: e.key,
              employmentType: e.employmentType ?? null,
              comment: e.comment ?? null,
              leaveReason: e.leaveReason ?? null
            }))
          }
      }
    }),

    applications_list: Effect.fn("mcp.applications_list")(function*(params) {
      const applications = yield* run(rpc.ApplicationsList({
        state: params.state,
        limit: clamp(params.limit, 20, 100)
      }))
      return { items: applications.map(applicationBrief), returned: applications.length }
    }),

    application_get: Effect.fn("mcp.application_get")(function*(params) {
      const detail = yield* run(rpc.ApplicationsGet({ id: params.id as ApplicationId }))
      const attempts = [...detail.attempts].sort((a, b) => a.seq - b.seq)
      const letter = detail.kit?.letter == null ? null : truncate(detail.kit.letter, 1500)
      return {
        application: applicationBrief(detail.application),
        decision: detail.decision == null ? null : decisionBrief(detail.decision, 8),
        form: formView(detail),
        kit: detail.kit == null
          ? null
          : {
            letter: letter?.text ?? null,
            letterTruncated: letter?.truncated ?? false,
            answers: detail.kit.answers.map((raw) => {
              const a = describeKitAnswer(raw, detail.form?.form)
              return {
                question: truncate(a.question, 300).text,
                answer: truncate(a.answer, 500).text
              }
            }),
            model: detail.kit.model ?? null,
            createdAt: detail.kit.createdAt
          },
        attempts: attempts.slice(-5).map((a) => ({
          seq: a.seq,
          stage: a.stage,
          exit: a.exit?.tag ?? null,
          message: a.exit?.message === undefined ? null : truncate(a.exit.message, 300).text,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt ?? null
        })),
        attemptsTotal: attempts.length
      }
    }),

    application_form: Effect.fn("mcp.application_form")(function*(params) {
      const detail = yield* run(rpc.ApplicationsGet({ id: params.applicationId as ApplicationId }))
      return { application: applicationBrief(detail.application), form: formView(detail) }
    }),

    conversations_list: Effect.fn("mcp.conversations_list")(function*(params) {
      const conversations = yield* run(rpc.ConversationsList({
        channel: params.channel,
        query: params.query,
        limit: clamp(params.limit, 20, 100)
      }))
      return { items: conversations.map(conversationBrief), returned: conversations.length }
    }),

    conversation_get: Effect.fn("mcp.conversation_get")(function*(params) {
      const maxChars = clamp(params.maxChars, 1000, 5000, 100)
      const detail = yield* run(rpc.ConversationGet({ id: params.id as ConversationId }))
      const ordered = [...detail.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      const latest = ordered.slice(-clamp(params.messages, 20, 100))
      return {
        conversation: conversationBrief(detail.conversation),
        messages: latest.map((m) => {
          const body = m.text == null ? null : truncate(m.text, maxChars)
          return {
            direction: m.direction,
            kind: m.kind,
            sentAt: m.sentAt,
            text: body?.text ?? null,
            truncated: body?.truncated ?? false
          }
        }),
        messagesTotal: ordered.length
      }
    }),

    contacts_list: Effect.fn("mcp.contacts_list")(function*(params) {
      const { items, total } = yield* run(rpc.ContactsList({
        query: params.query,
        kind: params.kind,
        vacancyId: params.vacancyId as VacancyId | undefined,
        limit: clamp(params.limit, 20, 100),
        offset: clamp(params.offset, 0, 100000, 0)
      }))
      return {
        items: items.map((c) => ({
          id: c.id as ContactId,
          person: c.personName,
          role: c.personRole,
          kind: c.kind,
          value: c.value,
          source: c.source,
          vacancyId: c.vacancyId,
          isBot: c.isBot
        })),
        total
      }
    })
  })
}))

const conversationBrief = (c: {
  readonly id: string
  readonly channel: string
  readonly title: string | null
  readonly personName: string | null
  readonly personRole: string | null
  readonly unreadCount: number
  readonly lastMessageAt: string | null
  readonly lastMessage: string | null
  readonly vacancyId: string | null
  readonly archived: boolean
}) => ({
  id: c.id,
  channel: c.channel,
  title: c.title,
  person: c.personName,
  personRole: c.personRole,
  unread: c.unreadCount,
  lastMessageAt: c.lastMessageAt,
  lastMessage: c.lastMessage === null ? null : truncate(c.lastMessage, 200).text,
  vacancyId: c.vacancyId,
  archived: c.archived
})
