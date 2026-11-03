import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { ToolFailure } from "./errors.ts"
import { ApplicationBrief } from "./shapes.ts"

/**
 * Write tools: they change state in the otbor API. Kept in their own toolkit
 * so `OTBOR_MCP_READONLY=1` can leave them out entirely. Only
 * `application_approve` sends something to an employer.
 */

const writeTool = <
  const Name extends string,
  P extends Schema.Top,
  S extends Schema.Top
>(
  name: Name,
  options: {
    readonly description: string
    readonly parameters: P
    readonly success: S
    /** Sends a real application on hh.ru. */
    readonly destructive?: boolean
    readonly idempotent?: boolean
    /** Reaches hh.ru (through the browser harness). */
    readonly openWorld?: boolean
  }
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: ToolFailure
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, options.destructive ?? false)
    .annotate(Tool.Idempotent, options.idempotent ?? false)
    .annotate(Tool.OpenWorld, options.openWorld ?? false)

/* ---------------------------------- fit ------------------------------------ */

export const FitSave = writeTool("fit_save", {
  description:
    "Save YOUR OWN judgement of how well the resume fits one vacancy (read vacancy_get and resume_get first). " +
    "It replaces the deterministic fit in the decision and re-ranks the vacancy; the returned decision shows " +
    "the new verdict, fit and priority. Optional: use it when the keyword fit looks wrong. Re-saving overwrites " +
    "the previous judgement for the same vacancy and resume. Sends nothing to hh.ru.",
  parameters: Schema.Struct({
    vacancyId: Schema.String.annotate({ description: "Vacancy id (UUID, id prefix or hh.ru URL)" }),
    resumeId: Schema.optional(Schema.String).annotate({ description: "Resume id; default: the active resume" }),
    fit: Schema.Int.annotate({ description: "0-100: how strong the match is" }),
    confidence: Schema.Number.annotate({ description: "0-1: how sure you are" }),
    verdict: Schema.Literals(["strong", "ok", "weak", "no"]),
    reasons: Schema.Array(Schema.String).annotate({ description: "One short sentence each: why it fits or not" }),
    disqualifiers: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "Must-have requirements the resume demonstrably lacks"
    }),
    quotes: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "Verbatim fragments of the vacancy or resume your reasons rely on"
    })
  }),
  success: Schema.Struct({
    vacancyId: Schema.String,
    resumeId: Schema.String,
    judgement: Schema.Struct({
      fit: Schema.NullOr(Schema.Int),
      verdict: Schema.NullOr(Schema.String),
      status: Schema.String,
      current: Schema.Boolean
    }),
    decision: Schema.Struct({
      id: Schema.String,
      verdict: Schema.String,
      fit: Schema.Number,
      priority: Schema.Number,
      gate: Schema.String
    })
  }),
  idempotent: true
})

/* ------------------------------ applications ------------------------------- */

export const ApplicationPrepare = writeTool("application_prepare", {
  description:
    "Start an application for a vacancy: creates a DRAFT application (nothing is sent) and queues a browser job " +
    "that opens the hh.ru response form to read its questions. Give decisionId (from vacancies_top) or vacancyId. " +
    "Idempotent: if an application already exists for this vacancy and hh account, it is returned instead " +
    "(existing: true). account (id, id prefix or name) defaults to the default/only account. Next: poll application_form until " +
    "prepare.status is \"prepared\".",
  parameters: Schema.Struct({
    decisionId: Schema.optional(Schema.String).annotate({ description: "Decision id from vacancies_top" }),
    vacancyId: Schema.optional(Schema.String).annotate({
      description: "Vacancy id, prefix or hh.ru URL; the latest decision for it is used"
    }),
    account: Schema.optional(Schema.String).annotate({
      description: "hh account: id, id prefix or name/label (see accounts_list). Default: the default/only account"
    }),
    hhAccountId: Schema.optional(Schema.String).annotate({ description: "Alias of account (an id)" }),
    resumeId: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({
    application: ApplicationBrief,
    existing: Schema.Boolean,
    next: Schema.String
  }),
  idempotent: true,
  openWorld: true
})

export const ApplicationPrepareManual = writeTool("application_prepare_manual", {
  description:
    "Manual mode: start an application for a vacancy the operator chose, WITHOUT a decision. Policy (title gate, " +
    "decision verdict, blacklist, fit) is bypassed; one application per (hh account, vacancy), the daily limit and " +
    "kit validation still apply, and nothing is sent. `vacancy` is an hh.ru URL, an external id, a vacancy UUID or " +
    "a UUID prefix (same resolution as vacancy_get); an hh URL or id that is not in the corpus yet is fetched once " +
    "from its public page. Creates a DRAFT and queues the browser job that opens the hh.ru response form to read " +
    "its questions (employer test included). Idempotent: an existing application for this vacancy and account is " +
    "returned (existing: true). account defaults to the default/only account; resumeId defaults to the account's " +
    "active resume (used for answer hints). Next: poll application_form until prepare.status is \"prepared\".",
  parameters: Schema.Struct({
    vacancy: Schema.String.annotate({ description: "hh.ru vacancy URL, hh external id, vacancy UUID or UUID prefix" }),
    account: Schema.optional(Schema.String).annotate({
      description: "hh account: id, id prefix or name/label (see accounts_list). Default: the default/only account"
    }),
    resumeId: Schema.optional(Schema.String).annotate({ description: "Resume id; default: the account's active resume" })
  }),
  success: Schema.Struct({
    application: ApplicationBrief,
    existing: Schema.Boolean,
    vacancyFetched: Schema.Boolean,
    resume: Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String })),
    next: Schema.String
  }),
  idempotent: true,
  openWorld: true
})

export const AnswerInput = Schema.Struct({
  questionId: Schema.String.annotate({ description: "Question id from application_form" }),
  optionIds: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "For single/multiple questions: option ids (not labels). One id for single."
  }),
  text: Schema.optional(Schema.String).annotate({ description: "For text questions (respect maxLength)" }),
  source: Schema.optional(Schema.Literals(["model", "human"])).annotate({
    description:
      "Default \"model\". Use \"human\" ONLY when the user wrote or explicitly confirmed this exact answer in chat; " +
      "code questions and blocked hints require it."
  }),
  needsHuman: Schema.optional(Schema.Boolean).annotate({
    description: "Set true when you are unsure; approve is then refused until the user confirms"
  })
})

export const KitSet = writeTool("kit_set", {
  description:
    "Save the cover letter and the form answers for an application (replaces the previous kit for this form). " +
    "Validated locally first against the form, hard hints and house style (no em dash or long dash, no emoji, no \"!\"); " +
    "if anything is wrong, ALL problems are returned together and nothing is saved. Questions with a hard hint and " +
    "no blockers may be omitted: they are filled from the hint. Does not send anything; approve is a separate step.",
  parameters: Schema.Struct({
    applicationId: Schema.String,
    letter: Schema.optional(Schema.NullOr(Schema.String)).annotate({ description: "Cover letter text" }),
    answers: Schema.Array(AnswerInput),
    model: Schema.optional(Schema.String).annotate({ description: "Label stored with the kit; default \"claude-chat\"" })
  }),
  success: Schema.Struct({
    saved: Schema.Boolean,
    applicationId: Schema.String,
    formHash: Schema.String,
    letterChars: Schema.Int,
    answered: Schema.Int,
    filledFromHints: Schema.Array(Schema.String),
    next: Schema.String
  }),
  idempotent: true
})

export const ApplicationApprove = writeTool("application_approve", {
  description:
    "SENDS A REAL APPLICATION on hh.ru, once and irreversibly. Call it only after the user has seen the " +
    "letter and answers (application_form / application_get) and explicitly agreed to send THIS application. " +
    "Requires confirm: true. The cloud re-validates the kit, enforces the daily limit per hh account, and queues " +
    "the single at-most-once submit; the application then moves queued -> submitting -> submitted. Check progress " +
    "later with application_get. If a submit looks stuck or ambiguous, do not approve again.",
  parameters: Schema.Struct({
    applicationId: Schema.String,
    confirm: Schema.Literal(true).annotate({
      description: "Must be literally true: the user agreed to send this application"
    })
  }),
  success: Schema.Struct({
    application: ApplicationBrief,
    queued: Schema.Boolean,
    note: Schema.String
  }),
  destructive: true,
  openWorld: true
})

export const ApplicationSkip = writeTool("application_skip", {
  description:
    "Drop an application you will not send: cancels its queued jobs and marks it skipped. Refused once it is " +
    "submitted. Sends nothing.",
  parameters: Schema.Struct({
    applicationId: Schema.String,
    reason: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ application: ApplicationBrief }),
  idempotent: true
})

export const OtborWriteToolkit = Toolkit.make(
  FitSave,
  ApplicationPrepare,
  ApplicationPrepareManual,
  KitSet,
  ApplicationApprove,
  ApplicationSkip
)
