import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HarnessId, HarnessJobId, HhAccountId, VacancyId } from "../ids.ts"
import { AgentCatalog, AgentHarness, HarnessJob } from "../models/index.ts"

export const InferenceEnqueue = Rpc.make("InferenceEnqueue", {
  payload: Schema.Struct({
    prompt: Schema.String,
    system: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    jsonSchema: Schema.optional(Schema.Unknown),
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

/** Harness side: the agents, models and efforts this harness found by probing. */
export const HarnessReportCatalog = Rpc.make("HarnessReportCatalog", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    harnesses: Schema.Array(AgentHarness)
  }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: ApiError
})

/** Web side: what the operator can pick from. Never starts an agent. */
export const AgentCatalogGet = Rpc.make("AgentCatalogGet", {
  payload: Schema.Struct({}),
  success: AgentCatalog,
  error: ApiError
})

/** How long the generated cover letter may be. Short is the default. */
export const DraftLetterLength = Schema.Literals(["short", "medium", "long"])

export type DraftLetterLength = typeof DraftLetterLength.Type

/**
 * Draft the cover letter and the employer-test answers of a vacancy in one
 * model call. Needs a stored form (`VacancyFormGet`) so questions and option
 * ids are known. The result is text in the job; the web parses and shows it.
 */
export const DraftGenerate = Rpc.make("DraftGenerate", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String),
    length: Schema.optional(DraftLetterLength),
    /** None: the harness default. */
    harness: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    effort: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

/** The exact prompt `DraftGenerate` would send for these inputs. Read-only; calls no model. */
export const DraftPromptPreview = Rpc.make("DraftPromptPreview", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String),
    length: Schema.optional(DraftLetterLength)
  }),
  success: Schema.Struct({
    system: Schema.String,
    user: Schema.String,
    promptVersion: Schema.String
  }),
  error: ApiError
})

export const InferenceGet = Rpc.make("InferenceGet", {
  payload: Schema.Struct({ id: HarnessJobId }),
  success: HarnessJob,
  error: ApiError
})
