import { ContactKind, ConversationChannel, PresetFilter, PresetKind } from "@otbor/contract"
import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { FormView } from "./apply.ts"
import { ToolFailure } from "./errors.ts"
import { AccountRef, ApplicationBrief, DecisionBrief, EmployerBrief, VacancyBrief } from "./shapes.ts"

/**
 * Tool definitions. Handlers live in `handlers.ts`.
 *
 * Read tools only. Write tools live in `write-tools.ts` (their own toolkit
 * and handlers layer) and are merged in `server.ts`, so `OTBOR_MCP_READONLY=1`
 * can register this toolkit alone.
 */

const readTool = <
  const Name extends string,
  P extends Schema.Top = typeof Tool.EmptyParams,
  S extends Schema.Top = typeof Schema.Void
>(
  name: Name,
  options: {
    readonly description: string
    readonly parameters?: P
    readonly success: S
    /** Reaches hh.ru (a single public page) through the otbor cloud. */
    readonly openWorld?: boolean
  }
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: ToolFailure
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, options.openWorld ?? false)

const limit = (description: string) => Schema.optional(Schema.Int).annotate({ description })
const text = (description: string) => Schema.optional(Schema.String).annotate({ description })
const NullableString = Schema.NullOr(Schema.String)
const account = Schema.optional(Schema.String).annotate({
  description: "Only this hh account: id, id prefix or name/label (see accounts_list). Default: all accounts"
})

/* --------------------------------- system ---------------------------------- */

export const SystemHealth = readTool("system_health", {
  description: "Check that the otbor API and its database are up, and the hh.ru session state of each account " +
    "(ok, expired, blocked). Call this first if other tools fail.",
  success: Schema.Struct({
    status: Schema.String,
    version: Schema.String,
    database: Schema.Boolean,
    now: Schema.String,
    apiUrl: Schema.String,
    accounts: Schema.Array(Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      profile: NullableString,
      sessionState: NullableString,
      lastOkAt: NullableString,
      lastError: NullableString
    }))
  })
})

export const QueueStats = readTool("queue_stats", {
  description:
    "Harness job queue counters (pending, running, failed, needs human, needs reconcile). " +
    "Use it to see whether anything is stuck.",
  success: Schema.Struct({
    pending: Schema.Int,
    leased: Schema.Int,
    running: Schema.Int,
    done: Schema.Int,
    failed: Schema.Int,
    dead: Schema.Int,
    needsHuman: Schema.Int,
    needsReconcile: Schema.Int,
    oldestPendingAgeSeconds: Schema.Int
  })
})

export const SchedulesList = readTool("schedules_list", {
  description: "Crawl and sync schedules: what runs, how often, last run and last error.",
  success: Schema.Struct({
    items: Schema.Array(Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      target: Schema.String,
      intervalMinutes: Schema.Int,
      enabled: Schema.Boolean,
      nextRunAt: NullableString,
      lastRunAt: NullableString,
      lastError: NullableString
    }))
  })
})

/* -------------------------------- vacancies -------------------------------- */

export const TopItem = Schema.Struct({
  rank: Schema.Int,
  decisionId: Schema.String,
  vacancyId: Schema.String,
  title: Schema.String,
  employer: NullableString,
  salary: NullableString,
  workFormats: Schema.Array(Schema.String),
  fit: Schema.Number,
  priority: Schema.Number,
  verdict: Schema.String,
  gate: Schema.String,
  account: Schema.NullOr(AccountRef),
  reasons: Schema.Array(Schema.String),
  /** Vacancy seniority: unknown, junior, middle, senior or lead. "unknown" means not stated, not "mid". */
  seniority: NullableString,
  /** hh experience requirement: noExperience, between1And3, between3And6, moreThan6. */
  experience: NullableString,
  /** The first few hh key skills. */
  skills: Schema.Array(Schema.String),
  publishedAt: NullableString,
  url: NullableString
})
export type TopItem = typeof TopItem.Type

export const VacanciesTop = readTool("vacancies_top", {
  description:
    "The best vacancies to apply to, ranked by decision priority (highest first), with fit, verdict and the " +
    "top human-readable reasons. Joined with employer, salary and hh url. Defaults to verdict \"apply\". " +
    "Ranking, the minFit and presetId filters and the \"newest decision per vacancy\" rule all run server-side, " +
    "so the result is the true top of the corpus, not of a recent window. Decisions come from the pipeline " +
    "(crawl and hydration evaluate automatically; `otbor decision evaluate --all` backfills). `considered` " +
    "equals `returned` and is kept for compatibility.",
  parameters: Schema.Struct({
    limit: limit("How many vacancies to return (default 10, max 50)"),
    presetId: text("Only vacancies matching this preset (see presets_list)"),
    verdict: Schema.optional(Schema.Literals(["apply", "draft", "skip"])).annotate({
      description: "Decision verdict filter (default \"apply\")"
    }),
    minFit: Schema.optional(Schema.Number).annotate({ description: "Minimum fit score, 0-100" }),
    account
  }),
  success: Schema.Struct({
    items: Schema.Array(TopItem),
    returned: Schema.Int,
    considered: Schema.Int,
    note: NullableString
  })
})

const SEARCH_DESCRIPTION = `Search the vacancy corpus with ad-hoc filters, for chat requests like "take 10 mediocre vacancies, around middle level, with Kubernetes, not big companies". Returns vacancies that have a decision (the pipeline makes decisions), joined with seniority, experience, top skills, employer, salary, fit, priority, account and hh url, so you can explain each choice. All criteria are ANDed. Filtering runs server-side in SQL with the same engine presets use (see presets_list / preset_preview). \`presetId\` and \`filter\` can be combined: the ad-hoc rules extend the preset's.

PARAMETERS
- filter: { rules?: [{field, op, value?}], text?, gate?, location?, includeArchived?, includeBlacklisted? }. Archived and blacklisted vacancies are excluded unless included explicitly. Prefer rules.
- verdict: apply (default) | draft | skip. The default "apply" only sees vacancies the policy would apply to; for "mediocre" or lower-fit requests pass verdict "draft" or "skip" and bound the score with minFit / maxFit (roughly 40-70 for mediocre).
- minFit / maxFit: fit score bounds, 0-100.
- account: hh account id, prefix or name. limit (default 10, max 50), offset.
- sort: priority (default, best first) | fit (highest fit first) | newest (newest published) | salary (highest, currencies are NOT converted) | random (a random sample, offset is not stable).

RULE FIELDS, operators and value shapes
- Text fields: title, description, employer (company name), area (city or region), salary_currency (RUR, USD, EUR), seniority, experience, employment_form, source. Operators: contains / not_contains (string, case-insensitive substring), eq / neq (string), in / not_in (string array).
- skills (hh key skills): contains / not_contains with a string, in / not_in with a string array (matches ANY, substring, case-insensitive).
- keywords (lexicon terms detected in the vacancy): same operators as skills; filter.location says where the term must appear: title, body, skills, text_or_skills, any.
- work_format: in / not_in with a string array of remote, hybrid, onsite, field.
- Number fields: salary_from, salary_to (in the vacancy's own currency; vacancies without a salary never match), published_days (published within N days: use lte), responses_total, description_length, skills_count, employer_vacancies, employer_rating, employer_reviews. Operators: gte, lte, eq, neq with a number. A null value (no rating, no reviews, no salary) never matches a number rule.
- archived: is_true / is_false. gate: eq with match | unknown | reject. role_family: eq with a family name.

SENIORITY. vacancy.seniority is junior, middle, senior, lead or unknown. About two thirds of the corpus is "unknown" (the vacancy does not say), which is not the same as "not middle". For "around middle" use {field:"seniority", op:"in", value:["middle","unknown"]}; strict "middle" drops most of the corpus. A second, independent signal is experience (hh requirement): noExperience, between1And3 (junior to middle), between3And6 (middle to senior), moreThan6 (senior). For example add experience in ["between1And3","between3And6"], or seniority not_in ["senior","lead"]. Every result carries both, so say which signal you relied on.

COMPANY SIZE. There is no headcount column yet. Working proxies: employer_vacancies (open vacancies of that employer in the corpus: 1-5 usually a small company, 30+ a big one or a recruiter), employer_reviews (number of hh reviews: thousands is a well known big company) and employer_rating (0-5). Say honestly that these are proxies. For "not big companies": employer_vacancies lte 10, optionally employer_reviews lte 300 (an employer without reviews has a null count and is NOT matched, so that rule also drops unreviewed small companies; leave it out if they matter).

EXAMPLES (value of the filter argument)
1. Around middle, Kubernetes, not a big company: {"rules":[{"field":"seniority","op":"in","value":["middle","unknown"]},{"field":"skills","op":"contains","value":"kubernetes"},{"field":"employer_vacancies","op":"lte","value":10}]}
2. Remote, at least 250000 RUR, not senior: {"rules":[{"field":"work_format","op":"in","value":["remote"]},{"field":"salary_from","op":"gte","value":250000},{"field":"salary_currency","op":"eq","value":"RUR"},{"field":"seniority","op":"not_in","value":["senior","lead"]}]}
3. Go or Rust in the title or skills, published this week, in Moscow or Saint Petersburg: {"rules":[{"field":"keywords","op":"in","value":["go","rust"]},{"field":"published_days","op":"lte","value":7},{"field":"area","op":"in","value":["Москва","Санкт-Петербург"]}],"location":"text_or_skills"}
4. Kubernetes in the description, decent employer rating, not a Yandex vacancy: {"rules":[{"field":"description","op":"contains","value":"kubernetes"},{"field":"employer_rating","op":"gte","value":3.5},{"field":"employer","op":"not_contains","value":"Яндекс"}]}`

export const VacanciesSearch = readTool("vacancies_search", {
  description: SEARCH_DESCRIPTION,
  parameters: Schema.Struct({
    filter: Schema.optional(PresetFilter).annotate({
      description: "Ad-hoc vacancy filter {rules:[{field,op,value}], text?, gate?, location?, includeArchived?, includeBlacklisted?}. See the tool description."
    }),
    presetId: text("Also require this saved preset's filter (see presets_list); ANDed with `filter`"),
    verdict: Schema.optional(Schema.Literals(["apply", "draft", "skip"])).annotate({
      description: "Decision verdict (default \"apply\")"
    }),
    minFit: Schema.optional(Schema.Number).annotate({ description: "Minimum fit score, 0-100" }),
    maxFit: Schema.optional(Schema.Number).annotate({ description: "Maximum fit score, 0-100" }),
    sort: Schema.optional(Schema.Literals(["priority", "fit", "newest", "salary", "random"])).annotate({
      description: "Order: priority (default), fit, newest, salary (currencies not converted), random"
    }),
    limit: limit("How many vacancies to return (default 10, max 50)"),
    offset: limit("Skip this many results (default 0)"),
    account
  }),
  success: Schema.Struct({
    items: Schema.Array(TopItem),
    returned: Schema.Int,
    note: NullableString
  })
})

export const VacancyGet = readTool("vacancy_get", {
  description:
    "One vacancy in full: description text (trimmed to maxChars, `truncated` says if cut), skills, matched " +
    "lexicon keywords, salary, employer, title gate verdict and the latest decision if any. `id` may be a " +
    "vacancy UUID, a UUID prefix, an hh.ru vacancy URL or an hh external id (digits). URL/prefix lookups scan " +
    "the 1000 most recent vacancies.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Vacancy id, id prefix, hh.ru URL or hh external id" }),
    maxChars: limit("Max description characters (default 4000, max 20000)")
  }),
  success: Schema.Struct({
    vacancy: VacancyBrief,
    experience: NullableString,
    employmentForm: NullableString,
    description: Schema.String,
    descriptionLength: Schema.Int,
    truncated: Schema.Boolean,
    skills: Schema.Array(Schema.String),
    keywords: Schema.Array(Schema.Struct({
      term: Schema.String,
      matchedForm: Schema.String,
      inTitle: Schema.Boolean,
      inBody: Schema.Boolean,
      inSkills: Schema.Boolean,
      bodyCount: Schema.Int,
      typo: Schema.Boolean
    })),
    titleGate: NullableString,
    decision: Schema.NullOr(DecisionBrief)
  })
})

export const DecisionsList = readTool("decisions_list", {
  description:
    "Recent decisions (newest first) with gate, fit, priority and reasons. Use vacancies_top for a ranked " +
    "shortlist; use this to audit why vacancies were skipped. minFit is applied client-side to the fetched page.",
  parameters: Schema.Struct({
    verdict: Schema.optional(Schema.Literals(["apply", "draft", "skip"])),
    minFit: Schema.optional(Schema.Number),
    account,
    limit: limit("Page size (default 20, max 100)"),
    offset: limit("Offset (default 0)")
  }),
  success: Schema.Struct({ items: Schema.Array(DecisionBrief), returned: Schema.Int })
})

export const FitGet = readTool("fit_get", {
  description:
    "The personal fit judgement for a vacancy: an LLM (or external agent) score of how well the resume matches " +
    "this vacancy, with verdict, confidence, reasons, disqualifiers (missing must-haves) and verbatim quotes. " +
    "`current` is false when the vacancy text, the resume or the prompt version changed since it was made; " +
    "a stale judgement is shown but no longer drives the decision. `judgement` is null when none exists " +
    "(`otbor fit enqueue` creates them). `id` may be a vacancy UUID, a UUID prefix, an hh.ru URL or an hh external id.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Vacancy id, id prefix, hh.ru URL or hh external id" }),
    resumeId: text("Only the judgement for this resume (default: the newest)")
  }),
  success: Schema.Struct({
    vacancyId: Schema.String,
    judgement: Schema.NullOr(Schema.Struct({
      status: Schema.String,
      current: Schema.Boolean,
      source: Schema.String,
      model: NullableString,
      resumeId: Schema.String,
      promptVersion: Schema.String,
      fit: Schema.NullOr(Schema.Int),
      confidence: Schema.NullOr(Schema.Number),
      verdict: NullableString,
      reasons: Schema.Array(Schema.String),
      disqualifiers: Schema.Array(Schema.String),
      quotes: Schema.Array(Schema.String),
      error: NullableString,
      updatedAt: Schema.String
    }))
  })
})

/* -------------------------------- accounts --------------------------------- */

export const AccountsList = readTool("accounts_list", {
  description:
    "The hh.ru accounts otbor applies from: id, name (hh display name, else label), label, whether it is the " +
    "default, its browser session profile and how many applications it has per state. Applications, decisions " +
    "and vacancies_top carry `account: {id, name}` and accept an `account` filter.",
  success: Schema.Struct({
    items: Schema.Array(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      label: Schema.String,
      isDefault: Schema.Boolean,
      sessionProfile: NullableString,
      applications: Schema.Record(Schema.String, Schema.Int)
    })),
    applicationsCountedFrom: Schema.Int.annotate({
      description: "Counts cover the most recently updated applications only (at most this many)"
    })
  })
})

/* --------------------------------- presets --------------------------------- */

const PresetBrief = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  system: Schema.Boolean,
  filter: Schema.Unknown
})

export const PresetsList = readTool("presets_list", {
  description: "Saved vacancy presets (explore and apply) with their filters.",
  parameters: Schema.Struct({ kind: Schema.optional(PresetKind) }),
  success: Schema.Struct({ items: Schema.Array(PresetBrief) })
})

const Facet = Schema.Struct({ term: Schema.String, count: Schema.Int })

export const PresetPreview = readTool("preset_preview", {
  description:
    "Preview what a preset matches: total count, top keywords, skills, companies and the first vacancies.",
  parameters: Schema.Struct({
    presetId: Schema.String.annotate({ description: "Preset id (see presets_list)" }),
    limit: limit("How many sample vacancies to return (default 10, max 50)")
  }),
  success: Schema.Struct({
    preset: Schema.Struct({ id: Schema.String, title: Schema.String, kind: Schema.String }),
    count: Schema.Int,
    keywords: Schema.Array(Facet),
    skills: Schema.Array(Facet),
    companies: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, count: Schema.Int })),
    vacancies: Schema.Array(VacancyBrief)
  })
})

/* -------------------------------- employers -------------------------------- */

export const EmployersList = readTool("employers_list", {
  description: "Search employers by name with rating, vacancy count and blacklist state.",
  parameters: Schema.Struct({
    query: text("Name substring"),
    includeBlacklisted: Schema.optional(Schema.Boolean),
    limit: limit("Page size (default 20, max 100)"),
    offset: limit("Offset (default 0)")
  }),
  success: Schema.Struct({ items: Schema.Array(EmployerBrief), total: Schema.Int })
})

export const EmployerGet = readTool("employer_get", {
  description:
    "One employer with its rating, reviews, the company profile from its hh page (about text, category, address, " +
    "trust flags; `profile` is null until the page was hydrated) and the vacancies we hold for it.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Employer id (UUID)" }),
    vacanciesLimit: limit("Max vacancies to include (default 10, max 50)"),
    maxChars: limit("Max characters of the company description (default 4000, max 20000)")
  }),
  success: Schema.Struct({
    employer: EmployerBrief,
    profile: Schema.NullOr(Schema.Struct({
      category: Schema.NullOr(Schema.String),
      address: Schema.NullOr(Schema.String),
      siteHost: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      truncated: Schema.Boolean,
      badges: Schema.Array(Schema.String),
      trusted: Schema.NullOr(Schema.Boolean),
      accreditedIt: Schema.NullOr(Schema.Boolean),
      activeVacancies: Schema.NullOr(Schema.Int),
      fetchedAt: Schema.NullOr(Schema.String)
    })),
    vacancies: Schema.Array(VacancyBrief),
    vacanciesTotal: Schema.Int
  })
})

/* --------------------------------- resumes --------------------------------- */

export const ResumesList = readTool("resumes_list", {
  description: "Resumes stored for the hh accounts.",
  parameters: Schema.Struct({ hhAccountId: text("Only this hh account") }),
  success: Schema.Struct({
    items: Schema.Array(Schema.Struct({
      id: Schema.String,
      hhAccountId: Schema.String,
      title: Schema.String,
      salary: NullableString,
      status: NullableString,
      isActive: Schema.Boolean,
      skills: Schema.Array(Schema.String),
      workFormats: Schema.Array(Schema.String)
    }))
  })
})

export const ResumeGet = readTool("resume_get", {
  description:
    "One resume with the operator's enrichment (comment, salary expectation, per-job notes) merged in. " +
    "Text is trimmed to maxChars; `truncated` says if cut.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Resume id (UUID)" }),
    maxChars: limit("Max characters for text/about each (default 3000, max 20000)")
  }),
  success: Schema.Struct({
    id: Schema.String,
    hhAccountId: Schema.String,
    title: Schema.String,
    skills: Schema.Array(Schema.String),
    workFormats: Schema.Array(Schema.String),
    salary: NullableString,
    status: NullableString,
    isActive: Schema.Boolean,
    experienceEntries: Schema.Int,
    about: Schema.String,
    text: Schema.String,
    truncated: Schema.Boolean,
    enrichment: Schema.NullOr(Schema.Struct({
      comment: Schema.String,
      salaryMin: Schema.NullOr(Schema.Int),
      salaryExpectation: Schema.NullOr(Schema.Int),
      currency: NullableString,
      experience: Schema.Array(Schema.Struct({
        key: Schema.String,
        employmentType: NullableString,
        comment: NullableString,
        leaveReason: NullableString
      }))
    }))
  })
})

/* ------------------------------- applications ------------------------------ */

export const ApplicationsList = readTool("applications_list", {
  description:
    "Applications and their state (draft, queued, submitting, submitted, skipped, needs_human, failed). " +
    "\"Waiting\" applications are usually draft or needs_human.",
  parameters: Schema.Struct({
    state: Schema.optional(Schema.Literals([
      "draft",
      "queued",
      "submitting",
      "submitted",
      "skipped",
      "needs_human",
      "failed"
    ])),
    account,
    limit: limit("Page size (default 20, max 100)")
  }),
  success: Schema.Struct({ items: Schema.Array(ApplicationBrief), returned: Schema.Int })
})

export const ApplicationGet = readTool("application_get", {
  description:
    "One application with its kit (cover letter and form answers, trimmed), the prepared hh.ru form " +
    "(question ids, options, hints, kit problems; same as application_form), the last attempts and the " +
    "decision that created it.",
  parameters: Schema.Struct({ id: Schema.String.annotate({ description: "Application id (UUID)" }) }),
  success: Schema.Struct({
    application: ApplicationBrief,
    decision: Schema.NullOr(DecisionBrief),
    form: FormView,
    kit: Schema.NullOr(Schema.Struct({
      letter: NullableString,
      letterTruncated: Schema.Boolean,
      answers: Schema.Array(Schema.Struct({ question: Schema.String, answer: Schema.String })),
      model: NullableString,
      createdAt: Schema.String
    })),
    attempts: Schema.Array(Schema.Struct({
      seq: Schema.Int,
      stage: Schema.String,
      exit: NullableString,
      message: NullableString,
      startedAt: Schema.String,
      finishedAt: NullableString
    })),
    attemptsTotal: Schema.Int
  })
})

export const ApplicationForm = readTool("application_form", {
  description:
    "Wait-free read of an application's prepared hh.ru form: questions with ids, kinds, options and the " +
    "deterministic hints (hard: true hints must be answered exactly as hinted; blockers mean ask the user), " +
    "plus the saved kit status and the problems approve would raise. prepare.status: pending (the browser " +
    "harness has not finished; poll again in a few seconds), prepared, blocked (needs a human, see detail), " +
    "unreadable, skipped. Does not change anything.",
  parameters: Schema.Struct({ applicationId: Schema.String.annotate({ description: "Application id (UUID)" }) }),
  success: Schema.Struct({ application: ApplicationBrief, form: FormView })
})

/* ------------------------------ manual mode -------------------------------- */

export const CoverLetterContext = readTool("cover_letter_context", {
  description:
    "Everything needed to write a cover letter (and answer an employer test) for ONE vacancy the operator chose, " +
    "in one call: the vacancy (description trimmed to maxChars), skills, the employer, the hh account's active " +
    "resume with the operator's enrichment, the existing application, kit and form state if any, and the style " +
    "rules. `vacancy` is an hh.ru URL, an external id, a vacancy UUID or a UUID prefix. If an hh URL or id is not " +
    "in the corpus yet, the public vacancy page is fetched once and stored (no application is created and " +
    "nothing is sent). Policy (title gate, decision, blacklist, fit) is NOT consulted: manual mode. `warnings` " +
    "lists things worth telling the user (blacklisted employer, archived vacancy, already submitted). " +
    "Next: application_prepare_manual.",
  parameters: Schema.Struct({
    vacancy: Schema.String.annotate({ description: "hh.ru vacancy URL, hh external id, vacancy UUID or UUID prefix" }),
    account: Schema.optional(Schema.String).annotate({
      description: "hh account: id, id prefix or name/label (see accounts_list). Default: the default/only account"
    }),
    maxChars: limit("Max description characters (default 4000, max 20000)")
  }),
  success: Schema.Struct({
    vacancy: Schema.Struct({
      brief: VacancyBrief,
      externalId: Schema.String,
      experience: NullableString,
      employmentForm: NullableString,
      description: Schema.String,
      descriptionLength: Schema.Int,
      truncated: Schema.Boolean,
      skills: Schema.Array(Schema.String),
      fetchedNow: Schema.Boolean
    }),
    employer: Schema.NullOr(EmployerBrief),
    account: AccountRef,
    resume: Schema.NullOr(Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      skills: Schema.Array(Schema.String),
      workFormats: Schema.Array(Schema.String),
      salary: NullableString,
      about: Schema.String,
      text: Schema.String,
      truncated: Schema.Boolean,
      enrichment: Schema.NullOr(Schema.Struct({
        comment: Schema.String,
        salaryMin: Schema.NullOr(Schema.Int),
        salaryExpectation: Schema.NullOr(Schema.Int),
        currency: NullableString,
        experience: Schema.Array(Schema.Struct({
          key: Schema.String,
          employmentType: NullableString,
          comment: NullableString,
          leaveReason: NullableString
        }))
      }))
    })),
    application: Schema.NullOr(Schema.Struct({
      brief: ApplicationBrief,
      prepare: NullableString,
      questions: Schema.Int,
      letter: NullableString,
      letterTruncated: Schema.Boolean,
      kitReadyToApprove: Schema.Boolean
    })),
    styleRules: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
    next: Schema.String
  }),
  openWorld: true
})

/* ------------------------- conversations and contacts ---------------------- */

const ConversationBrief = Schema.Struct({
  id: Schema.String,
  channel: Schema.String,
  title: NullableString,
  person: NullableString,
  personRole: NullableString,
  unread: Schema.Int,
  lastMessageAt: NullableString,
  lastMessage: NullableString,
  vacancyId: NullableString,
  archived: Schema.Boolean
})

export const ConversationsList = readTool("conversations_list", {
  description: "Mail, Telegram and hh chat threads, newest first, with the last message preview.",
  parameters: Schema.Struct({
    channel: Schema.optional(ConversationChannel),
    query: text("Text search"),
    limit: limit("Page size (default 20, max 100)")
  }),
  success: Schema.Struct({ items: Schema.Array(ConversationBrief), returned: Schema.Int })
})

export const ConversationGet = readTool("conversation_get", {
  description: "One conversation with its most recent messages (oldest first). Long messages are trimmed.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Conversation id (UUID)" }),
    messages: limit("How many latest messages (default 20, max 100)"),
    maxChars: limit("Max characters per message (default 1000, max 5000)")
  }),
  success: Schema.Struct({
    conversation: ConversationBrief,
    messages: Schema.Array(Schema.Struct({
      direction: Schema.String,
      kind: Schema.String,
      sentAt: Schema.String,
      text: NullableString,
      truncated: Schema.Boolean
    })),
    messagesTotal: Schema.Int
  })
})

export const ContactsList = readTool("contacts_list", {
  description: "Recruiter and employer contacts extracted from vacancies and conversations.",
  parameters: Schema.Struct({
    query: text("Text search"),
    kind: Schema.optional(ContactKind),
    vacancyId: text("Only contacts found on this vacancy"),
    limit: limit("Page size (default 20, max 100)"),
    offset: limit("Offset (default 0)")
  }),
  success: Schema.Struct({
    items: Schema.Array(Schema.Struct({
      id: Schema.String,
      person: NullableString,
      role: NullableString,
      kind: Schema.String,
      value: Schema.String,
      source: Schema.String,
      vacancyId: NullableString,
      isBot: Schema.Boolean
    })),
    total: Schema.Int
  })
})

/* --------------------------------- toolkit --------------------------------- */

export const OtborReadToolkit = Toolkit.make(
  SystemHealth,
  AccountsList,
  VacanciesTop,
  VacanciesSearch,
  VacancyGet,
  DecisionsList,
  FitGet,
  PresetsList,
  PresetPreview,
  EmployersList,
  EmployerGet,
  ResumesList,
  ResumeGet,
  ApplicationsList,
  ApplicationGet,
  ApplicationForm,
  CoverLetterContext,
  ConversationsList,
  ConversationGet,
  ContactsList,
  SchedulesList,
  QueueStats
)

const READ_INSTRUCTIONS = `otbor is an hh.ru auto-apply control plane.

Domain model, in pipeline order:
- vacancy: a job posting crawled from hh.ru (title, employer, salary, description, skills).
- gate: a deterministic title check (match / unknown / reject). Only "match" vacancies can be applied to.
- decision: the policy result for a vacancy: verdict (apply / draft / skip), fit (0-100 against the resume), priority (ranking score) and reasons (why). Reasons starting with "blocked_" explain a skip. The "fit" reason says whether the number is "deterministic" (keyword rules, saturates near 95-100) or "llm" (a personal judgement, see fit_get).
- application: created from an apply/draft decision; states draft, queued, submitting, submitted, skipped, needs_human, failed. Submit is at-most-once; "waiting" usually means draft or needs_human. Applications the operator made by hand on hh.ru are imported by the operator CLI command "otbor hh sync" as state submitted with origin "imported" (and hh's own status); they count as already applied (blocked_applied), cannot be approved or prepared again, and are not otbor submits. This server has no tool to run or change the sync.
- kit: the cover letter and form answers prepared for an application.
Also: hh accounts (accounts_list; several can exist), presets (saved filters), employers (with blacklist state), resumes (with operator enrichment), conversations and contacts (replies from recruiters), schedules (crawls) and the harness queue.

How to use the read tools:
- "take N vacancies that are ..." (level, skill, company size, salary, remote, fit range, random sample): vacancies_search with a \`filter\`. Read its description first: it lists the rule fields and operators, how seniority "unknown" is treated and the company-size proxies.
- "best vacancies / what should I apply to": vacancies_top, then vacancy_get for details of the interesting ones.
- "what does vacancy X need": vacancy_get (accepts an id, id prefix or hh.ru URL).
- "what is waiting": applications_list with state draft or needs_human, then application_get.
- "write a letter for this vacancy URL" (manual mode, the operator chose the vacancy): cover_letter_context gets everything in one call (see Manual mode below).
- Accounts: applications and decisions belong to an hh account and show it as account {id, name}. Read tools take an optional \`account\` (id, id prefix or name/label, case-insensitive) and cover all accounts without it. Write tools use \`account\`, else the default account, else the only one; with several accounts and no default they fail and list them.
- If a tool says the API is not reachable, tell the user to run \`otbor up\` and retry; use system_health to confirm.
Outputs are compact and long texts are trimmed (check the truncated flag; raise maxChars if you need more).`

export const READONLY_NOTE = "This server is running READ-ONLY (OTBOR_MCP_READONLY=1): there are no tools that change anything."

const WRITE_INSTRUCTIONS = `

Applying (write tools). application_approve SENDS A REAL APPLICATION on hh.ru, once and irreversibly. Everything before it is a draft and can be redone or dropped. Recommended workflow, one vacancy at a time (the tools are atomic; you orchestrate):
1. vacancies_top for candidates. Optionally read vacancy_get + resume_get and, if the keyword fit looks wrong, record your own view with fit_save (it re-ranks).
2. application_prepare (decisionId from vacancies_top). Idempotent: an existing application for that vacancy and account is returned. It queues a browser job that opens the hh.ru form.
3. Poll application_form until prepare.status is "prepared" (pending means the harness is still working: wait a few seconds; blocked/unreadable/skipped means stop and tell the user). Do not hammer it; for several vacancies, prepare them all first, then poll.
4. Write the letter and answers yourself from resume_get and vacancy_get. Be specific and truthful; never invent experience. Hints with hard: true must be answered exactly as hinted (they may be omitted, kit_set fills them). A hint with blockers, or a code question, needs the user's own answer (source "human"). Style rules for everything sent to an employer: no em dash or other long dashes, no emoji, no exclamation marks. Honor maxLength and answer with option ids, not labels.
5. kit_set. All problems are returned together and nothing is saved until the kit is valid; fix them and call again.
6. Show the user a summary per application (vacancy, employer, letter, answers) and ask whether to send. Only after the user agreed to THESE applications, call application_approve with confirm: true, one call per application. "Reply to the 10 best" is a request to prepare drafts and show them, not consent to send unseen text, unless the user explicitly said to send without review.
7. Later: application_get shows queued -> submitting -> submitted and the attempts. Never approve again to "retry" a submit that is in flight or looks ambiguous; report it to the user. application_skip drops a draft you will not send.
The server enforces a daily limit of submits per hh account (LimitExceeded): if it is hit, stop, tell the user when the next slot frees, and do not retry.

Manual mode ("here is a vacancy URL, write the cover letter", and answer the employer test if there is one). The operator chose the vacancy, so policy is bypassed: title gate, decision verdict, blacklist and fit are NOT consulted (cover_letter_context only warns about them). Safety is not bypassed: one application per (account, vacancy), the daily submit limit, kit validation and the at-most-once submit all apply, and application_approve still needs the user's explicit confirmation. Sequence:
1. cover_letter_context with vacancy (hh.ru URL, external id, UUID or prefix) and optionally account. One call returns the vacancy, skills, employer, the account's active resume with the operator's enrichment, any existing application and kit, the style rules and warnings. A vacancy that is not in the corpus yet is fetched once from its public hh.ru page. Read warnings to the user (already submitted, blacklisted employer, archived). If the call fails because the page cannot be fetched, tell the user to run \`otbor vacancy fetch <url>\` (or \`otbor crawl <search url> --hydrate\`) and retry.
2. application_prepare_manual with the same vacancy and account. It creates the draft without a decision (idempotent: an existing application for that account and vacancy is returned) and queues the browser job that opens the response form.
3. Poll application_form until prepare.status is "prepared". If the vacancy has an employer test or questions, they appear in form.questions (kind single/multiple/text/code, option ids, maxLength, required, hint). blocked, unreadable or skipped: stop and tell the user; an unreadable form (layout not recognized) must be filled in on hh.ru by hand.
4. Write the letter and every answer yourself from cover_letter_context (or resume_get and vacancy_get), truthfully, specific to this vacancy, in the vacancy's language. Never invent experience, tools, numbers or employers; if the resume does not say it, ask the user. No em dash or other long dash, no emoji, no exclamation marks in the letter or in any text answer. Questions: hints with hard: true are answered exactly as hinted (kit_set fills them if you omit them); choice questions are answered with option ids, text with respect to maxLength; salary, relocation, start date and similar personal facts come from the resume enrichment or from the user, never guessed. A hint with blockers, and every code question (kind "code"), needs the USER'S OWN answer: show the question, ask, and save exactly what they wrote or confirmed with source "human". Do not write code answers yourself. Set needsHuman: true on anything you are unsure about.
5. kit_set. All problems come back together and nothing is saved until the kit is valid; fix and call again.
6. Show the user the vacancy, employer, the letter and each question with its answer, and ask whether to send. Only after they agree to THIS application, call application_approve with confirm: true, once. Never approve in the same turn as drafting unless the user already said to send without review.`

export const serverInstructions = (readOnly: boolean): string =>
  readOnly ? `${READ_INSTRUCTIONS}\n\n${READONLY_NOTE}` : `${READ_INSTRUCTIONS}${WRITE_INSTRUCTIONS}`

/** Full instructions (read + write). The server picks `serverInstructions(readOnly)`. */
export const SERVER_INSTRUCTIONS = serverInstructions(false)
