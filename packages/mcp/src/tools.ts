import { ContactKind, ConversationChannel, PresetKind } from "@otbor/contract"
import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { FormView } from "./apply.ts"
import { ToolFailure } from "./errors.ts"
import { ApplicationBrief, DecisionBrief, EmployerBrief, VacancyBrief } from "./shapes.ts"

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
  options: { readonly description: string; readonly parameters?: P; readonly success: S }
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
    .annotate(Tool.OpenWorld, false)

const limit = (description: string) => Schema.optional(Schema.Int).annotate({ description })
const text = (description: string) => Schema.optional(Schema.String).annotate({ description })
const NullableString = Schema.NullOr(Schema.String)

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
  reasons: Schema.Array(Schema.String),
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
    minFit: Schema.optional(Schema.Number).annotate({ description: "Minimum fit score, 0-100" })
  }),
  success: Schema.Struct({
    items: Schema.Array(TopItem),
    returned: Schema.Int,
    considered: Schema.Int,
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
  description: "One employer with its rating, reviews and the vacancies we hold for it.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Employer id (UUID)" }),
    vacanciesLimit: limit("Max vacancies to include (default 10, max 50)")
  }),
  success: Schema.Struct({
    employer: EmployerBrief,
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
  VacanciesTop,
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
Also: presets (saved filters), employers (with blacklist state), resumes (with operator enrichment), conversations and contacts (replies from recruiters), schedules (crawls) and the harness queue.

How to use the read tools:
- "best vacancies / what should I apply to": vacancies_top, then vacancy_get for details of the interesting ones.
- "what does vacancy X need": vacancy_get (accepts an id, id prefix or hh.ru URL).
- "what is waiting": applications_list with state draft or needs_human, then application_get.
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
The server enforces a daily limit of submits per hh account (LimitExceeded): if it is hit, stop, tell the user when the next slot frees, and do not retry.`

export const serverInstructions = (readOnly: boolean): string =>
  readOnly ? `${READ_INSTRUCTIONS}\n\n${READONLY_NOTE}` : `${READ_INSTRUCTIONS}${WRITE_INSTRUCTIONS}`

/** Full instructions (read + write). The server picks `serverInstructions(readOnly)`. */
export const SERVER_INSTRUCTIONS = serverInstructions(false)
