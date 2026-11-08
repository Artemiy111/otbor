import type {
  ApplicationId,
  ContactId,
  ConversationId,
  DecisionRecord,
  EmployerId,
  HhAccountId,
  OtborApi,
  PersonId,
  PresetFilter,
  PresetId,
  ResumeId,
  VacancyId
} from "@otbor/contract"
import { describeKitAnswer, RESUME_FAQ_TOPICS } from "@otbor/contract"
import { Effect } from "effect"
import { accountsFor, pickAccount } from "./accounts.ts"
import { Api } from "./api.ts"
import { guard, ToolFailure } from "./errors.ts"
import {
  accountDirectory,
  accountName,
  accountRef,
  analysisBrief,
  applicationBrief,
  applyFilterBrief,
  clamp,
  decisionBrief,
  employerBrief,
  formatSalary,
  humanReasons,
  truncate,
  vacancyBrief
} from "./shapes.ts"
import { formView, STYLE_RULES } from "./apply.ts"
import { OtborReadToolkit, type TopItem } from "./tools.ts"

const DECISION_PAGE = 200
const DECISION_PAGES = 4
const VACANCY_PAGE = 200
const VACANCY_PAGES = 5
const APPLICATION_COUNT_WINDOW = 200

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

const HH_REFERENCE = /vacancy\/\d+|^\d+$/

/**
 * Manual mode: a vacancy by hh URL or external id is fetched into the corpus
 * when it is not there yet (one public page, done by the cloud); a UUID or a
 * prefix can only name something already stored.
 */
export const resolveOrFetchVacancy = (rpc: OtborApi, reference: string) =>
  Effect.gen(function*() {
    const ref = reference.trim()
    if (!HH_REFERENCE.test(ref)) {
      return { vacancyId: yield* resolveVacancyId(rpc, ref), fetched: false }
    }
    const fetched = yield* rpc.VacancyFetch({ reference: ref }).pipe(
      Effect.catchTag("InvalidInput", (error) =>
        fail(
          `could not get vacancy "${ref}" into the corpus: ${error.message}. ` +
            "Ask the operator to run `otbor vacancy fetch <url>` (or `otbor crawl <search url> --hydrate`) and retry."
        )
      )
    )
    return { vacancyId: fetched.vacancyId, fetched: !fetched.alreadyKnown }
  })

/** The resume an application for this account should use: the named one, else the first active one. */
export const pickResume = (rpc: OtborApi, hhAccountId: HhAccountId, explicit: string | undefined) =>
  Effect.gen(function*() {
    const resumes = yield* rpc.ResumesList({ hhAccountId })
    if (explicit !== undefined && explicit.trim() !== "") {
      const wanted = explicit.trim().toLowerCase()
      const found = resumes.find((r) => r.id.toLowerCase() === wanted) ??
        resumes.find((r) => wanted.length >= 4 && r.id.toLowerCase().startsWith(wanted))
      if (found === undefined) {
        return yield* fail(`resume "${explicit}" is not one of this account's resumes; see resumes_list`)
      }
      return found
    }
    return resumes.find((r) => r.isActive) ?? undefined
  })

/** A resume with the operator's enrichment merged in; shared by resume_get and cover_letter_context. */
export const loadResume = (rpc: OtborApi, id: ResumeId, maxChars: number) =>
  Effect.gen(function*() {
    const resume = yield* rpc.ResumeGet({ id })
    const enrichment = yield* rpc.ResumeEnrichmentGet({ resumeId: id }).pipe(
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
          salaries: enrichment.salaries.map((s) => ({ currency: s.currency, min: s.min, expectation: s.expectation })),
          faq: enrichment.faq.map((e) => ({
            key: e.key,
            question: e.question ?? RESUME_FAQ_TOPICS.find((t) => t.key === e.key)?.question ?? e.key,
            answer: e.answer
          })),
          experience: enrichment.experience.map((e) => ({
            key: e.key,
            employmentType: e.employmentType ?? null,
            comment: e.comment ?? null,
            leaveReason: e.leaveReason ?? null
          }))
        }
    }
  })

export const OtborReadHandlers = OtborReadToolkit.toLayer(Effect.gen(function*() {
  const api = yield* Api
  const rpc = api.rpc
  const run = guard(api)

  const rankVacancies = Effect.fnUntraced(function*(params: {
    readonly limit?: number | undefined
    readonly offset?: number | undefined
    readonly presetId?: string | undefined
    readonly verdict?: "apply" | "draft" | "skip" | undefined
    readonly minFit?: number | undefined
    readonly maxFit?: number | undefined
    readonly account?: string | undefined
    readonly filter?: PresetFilter | undefined
    readonly sort?: "priority" | "fit" | "newest" | "salary" | "random" | undefined
  }) {
    const count = clamp(params.limit, 10, 50)
    const { filter: accountFilter, directory } = yield* accountsFor(run(rpc.HhAccountsList()), params.account)
    const verdict = params.verdict ?? "apply"

    let presetId: string | undefined
    if (params.presetId !== undefined) {
      const wanted = params.presetId.toLowerCase()
      const presets = yield* run(rpc.PresetsList({}))
      const preset = presets.find((p) => p.id === wanted || p.id.startsWith(wanted))
      if (preset === undefined) return yield* fail(`preset not found: ${params.presetId}`)
      presetId = preset.id
    }

    // Ranking happens in the database: sorted, newest decision per vacancy
    // only, preset, ad-hoc filter and fit bounds applied before the limit.
    const ranked = yield* run(rpc.DecisionsList({
      verdict,
      orderBy: "priority",
      latestPerVacancy: true,
      limit: count,
      ...(params.sort === undefined || params.sort === "priority" ? {} : { sort: params.sort }),
      ...(params.offset === undefined ? {} : { offset: clamp(params.offset, 0, 100000, 0) }),
      ...(accountFilter === undefined ? {} : { hhAccountId: accountFilter.id }),
      ...(params.minFit === undefined ? {} : { minFit: Math.trunc(params.minFit) }),
      ...(params.maxFit === undefined ? {} : { maxFit: Math.trunc(params.maxFit) }),
      ...(params.filter === undefined ? {} : { filter: params.filter }),
      ...(presetId === undefined ? {} : { presetId: presetId as PresetId })
    }))
    const notes: Array<string> = []

    const details = yield* Effect.forEach(
      ranked,
      (d) =>
        run(rpc.VacanciesGet({ id: d.vacancyId })).pipe(
          Effect.catch(() => Effect.succeed(undefined))
        ),
      { concurrency: 5 }
    )

    const items: Array<TopItem> = ranked.map((d, index) => {
      const detail = details[index]
      const v = detail?.vacancy
      return {
        rank: (params.offset ?? 0) + index + 1,
        decisionId: d.id,
        vacancyId: d.vacancyId,
        title: v?.title ?? d.vacancyTitle ?? "(unknown title)",
        employer: v?.employerName ?? null,
        salary: v ? formatSalary(v.salaryFrom, v.salaryTo, v.salaryCurrency) : null,
        workFormats: v?.workFormats ?? [],
        fit: d.fit,
        priority: d.priority,
        verdict: d.verdict,
        account: d.hhAccountId == null ? null : accountRef(directory, d.hhAccountId),
        reasons: humanReasons(d.reasons, 4, d.createdAt),
        seniority: v?.seniority ?? null,
        experience: v?.experienceCode ?? null,
        skills: (detail?.skills ?? []).slice(0, 6),
        publishedAt: v?.publishedAt ?? null,
        url: v?.canonicalUrl ?? null
      }
    })

    return { items, note: notes.length === 0 ? null : notes.join("; ") }
  })

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
      return yield* run(rpc.QueueStatsGet({}))
    }),

    accounts_list: Effect.fn("mcp.accounts_list")(function*() {
      const accounts = yield* run(rpc.HhAccountsList())
      const applications = yield* run(rpc.ApplicationsList({ limit: APPLICATION_COUNT_WINDOW }))
      return {
        items: accounts.map((account) => {
          const counts: Record<string, number> = {}
          for (const a of applications) {
            if (a.hhAccountId === account.id) counts[a.state] = (counts[a.state] ?? 0) + 1
          }
          return {
            id: account.id,
            name: accountName(account),
            label: account.label,
            isDefault: account.isDefault,
            sessionProfile: account.sessionProfile,
            applications: counts
          }
        }),
        applicationsCountedFrom: APPLICATION_COUNT_WINDOW
      }
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
      const { items, note } = yield* rankVacancies({ ...params, sort: "priority" })
      return { items, returned: items.length, considered: items.length, note }
    }),

    vacancies_search: Effect.fn("mcp.vacancies_search")(function*(params) {
      const { items, note } = yield* rankVacancies(params)
      return { items, returned: items.length, note }
    }),

    vacancy_get: Effect.fn("mcp.vacancy_get")(function*(params) {
      const maxChars = clamp(params.maxChars, 4000, 20000, 200)
      const id = yield* run(resolveVacancyId(rpc, params.id))
      const detail = yield* run(rpc.VacanciesGet({ id }))
      const { directory } = yield* accountsFor(run(rpc.HhAccountsList()), undefined)
      const decisions = yield* run(scanDecisions(rpc, undefined)).pipe(Effect.catch(() => Effect.succeed([])))
      const latest = decisions.find((d) => d.vacancyId === id)
      const stored = yield* run(rpc.VacancyAnalysisGet({ vacancyId: id as VacancyId })).pipe(
        Effect.catch(() => Effect.succeed(null))
      )
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
        decision: latest === undefined ? null : decisionBrief(latest, 8, directory),
        analysis: stored === null ? null : analysisBrief(stored)
      }
    }),

    decisions_list: Effect.fn("mcp.decisions_list")(function*(params) {
      const { filter, directory } = yield* accountsFor(run(rpc.HhAccountsList()), params.account)
      const decisions = yield* run(rpc.DecisionsList({
        verdict: params.verdict,
        ...(filter === undefined ? {} : { hhAccountId: filter.id }),
        limit: clamp(params.limit, 20, 100),
        offset: clamp(params.offset, 0, 100000, 0)
      }))
      const items = decisions
        .filter((d) => params.minFit === undefined || d.fit >= params.minFit)
        .map((d) => decisionBrief(d, 5, directory))
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

    apply_filter_get: Effect.fn("mcp.apply_filter_get")(function*(params) {
      const accounts = yield* run(rpc.HhAccountsList())
      const account = yield* pickAccount(accounts, params.account)
      const resume = params.resume === undefined || params.resume.trim() === ""
        ? undefined
        : yield* run(pickResume(rpc, account.id, params.resume))
      const view = yield* run(rpc.ApplyFilterGet({
        hhAccountId: account.id,
        ...(resume === undefined ? {} : { resumeId: resume.id })
      }))
      const usage = yield* run(rpc.ApplyUsageGet({ hhAccountId: account.id }))
      return applyFilterBrief(view, accountDirectory(accounts), usage)
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
      const maxChars = clamp(params.maxChars, 4000, 20000)
      const profile = detail.profile ?? null
      const about = profile?.descriptionText == null ? null : truncate(profile.descriptionText, maxChars)
      return {
        employer: employerBrief(detail.employer),
        profile: profile === null
          ? null
          : {
            category: profile.category,
            address: profile.address,
            siteHost: profile.siteHost,
            description: about?.text ?? null,
            truncated: about?.truncated ?? false,
            badges: profile.badges.flatMap((b) => (b.description ?? b.type) === null ? [] : [(b.description ?? b.type)!]),
            trusted: profile.trusted,
            accreditedIt: profile.accreditedIt,
            activeVacancies: profile.activeVacancies,
            fetchedAt: profile.fetchedAt
          },
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
      return yield* run(loadResume(rpc, params.id as ResumeId, maxChars))
    }),

    cover_letter_context: Effect.fn("mcp.cover_letter_context")(function*(params) {
      const maxChars = clamp(params.maxChars, 4000, 20000, 200)
      const accounts = yield* run(rpc.HhAccountsList())
      const account = yield* pickAccount(accounts, params.account)
      const directory = accountDirectory(accounts)

      const { vacancyId, fetched } = yield* run(resolveOrFetchVacancy(rpc, params.vacancy))
      const detail = yield* run(rpc.VacanciesGet({ id: vacancyId }))
      const v = detail.vacancy
      const description = truncate(detail.descriptionText, maxChars)

      const employer = v.employerId == null
        ? null
        : yield* run(rpc.EmployersGet({ id: v.employerId as EmployerId })).pipe(
          Effect.map((e) => employerBrief(e.employer)),
          Effect.catch(() => Effect.succeed(null))
        )

      const resumeRecord = yield* run(pickResume(rpc, account.id, undefined))
      const resume = resumeRecord === undefined
        ? null
        : yield* run(loadResume(rpc, resumeRecord.id, 3000))

      const known = yield* run(rpc.ApplicationsList({ hhAccountId: account.id, limit: 500 }))
      const existing = known.find((a) => a.vacancyId === vacancyId)
      const applicationDetail = existing === undefined
        ? undefined
        : yield* run(rpc.ApplicationsGet({ id: existing.id }))
      const view = applicationDetail === undefined ? undefined : formView(applicationDetail)
      const letter = applicationDetail?.kit?.letter == null ? null : truncate(applicationDetail.kit.letter, 1500)

      const warnings: Array<string> = []
      if (existing?.state === "submitted") {
        warnings.push(
          `an application for this vacancy was already submitted from this account (${existing.origin ?? "otbor"}); do not apply again`
        )
      } else if (existing?.state === "skipped") {
        warnings.push(
          "an application for this vacancy exists in state skipped and cannot be prepared again from here; tell the user"
        )
      }
      if (v.blacklisted) warnings.push("the employer is on the blacklist (ignored in manual mode); mention it to the user")
      if (v.archived) warnings.push("the vacancy is archived on hh.ru; applying may not be possible")
      if (resume === null) {
        warnings.push("this account has no active resume stored, so there is nothing to write from and answer hints are weaker: ask the user")
      } else if (resume.enrichment === null) {
        warnings.push("the resume has no operator enrichment; ask the user for facts it does not state (salary, relocation, start date)")
      }
      if (description.truncated) warnings.push("the description is trimmed; raise maxChars if you need the rest")

      const next = existing === undefined
        ? "call application_prepare_manual with the same vacancy and account"
        : existing.state === "submitted"
        ? "already submitted; nothing to do"
        : "an application exists; call application_form for its form and kit, then continue with kit_set"

      return {
        vacancy: {
          brief: vacancyBrief(v),
          externalId: v.externalId,
          experience: v.experienceCode ?? null,
          employmentForm: v.employmentForm ?? null,
          description: description.text,
          descriptionLength: detail.descriptionText.length,
          truncated: description.truncated,
          skills: detail.skills,
          fetchedNow: fetched
        },
        employer,
        account: accountRef(directory, account.id),
        resume: resume === null
          ? null
          : {
            id: resume.id,
            title: resume.title,
            skills: resume.skills,
            workFormats: resume.workFormats,
            salary: resume.salary,
            about: resume.about,
            text: resume.text,
            truncated: resume.truncated,
            enrichment: resume.enrichment
          },
        application: existing === undefined || view === undefined
          ? null
          : {
            brief: applicationBrief(existing, directory),
            prepare: view.prepare.status === "prepared"
              ? "prepared"
              : `${view.prepare.status}${view.prepare.detail === null ? "" : `: ${view.prepare.detail}`}`,
            questions: view.questions.length,
            letter: letter?.text ?? null,
            letterTruncated: letter?.truncated ?? false,
            kitReadyToApprove: view.kit.readyToApprove
          },
        styleRules: STYLE_RULES,
        warnings,
        next
      }
    }),

    applications_list: Effect.fn("mcp.applications_list")(function*(params) {
      const { filter, directory } = yield* accountsFor(run(rpc.HhAccountsList()), params.account)
      const applications = yield* run(rpc.ApplicationsList({
        state: params.state,
        ...(filter === undefined ? {} : { hhAccountId: filter.id }),
        limit: clamp(params.limit, 20, 100)
      }))
      return { items: applications.map((a) => applicationBrief(a, directory)), returned: applications.length }
    }),

    application_get: Effect.fn("mcp.application_get")(function*(params) {
      const detail = yield* run(rpc.ApplicationsGet({ id: params.id as ApplicationId }))
      const { directory } = yield* accountsFor(run(rpc.HhAccountsList()), undefined)
      const attempts = [...detail.attempts].sort((a, b) => a.seq - b.seq)
      const letter = detail.kit?.letter == null ? null : truncate(detail.kit.letter, 1500)
      return {
        application: applicationBrief(detail.application, directory),
        decision: detail.decision == null ? null : decisionBrief(detail.decision, 8, directory),
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
      const { directory } = yield* accountsFor(run(rpc.HhAccountsList()), undefined)
      return { application: applicationBrief(detail.application, directory), form: formView(detail) }
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
    }),

    people_list: Effect.fn("mcp.people_list")(function*(params) {
      const { items, total } = yield* run(rpc.PersonList({
        query: params.query,
        limit: clamp(params.limit, 20, 100),
        offset: clamp(params.offset, 0, 100000, 0)
      }))
      return {
        items: items.map((p) => ({
          id: p.id,
          name: p.displayName,
          role: p.role,
          employerId: p.employerId,
          contacts: p.contactCount,
          conversations: p.conversationCount,
          lastSeenAt: p.lastSeenAt
        })),
        total
      }
    }),

    person_get: Effect.fn("mcp.person_get")(function*(params) {
      const p = yield* run(rpc.PersonGet({ id: params.id as PersonId }))
      return {
        id: p.id,
        name: p.displayName,
        role: p.role,
        notes: p.notes,
        employerId: p.employerId,
        lastSeenAt: p.lastSeenAt,
        contacts: p.contacts.map((c) => ({
          id: c.id as string,
          kind: c.kind,
          value: c.value,
          source: c.source,
          link: c.personLink,
          confidence: c.confidence,
          isBot: c.isBot
        })),
        conversations: p.conversations.map(conversationBrief),
        vacancyIds: [...p.vacancyIds],
        resumeIds: [...p.resumeIds]
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
