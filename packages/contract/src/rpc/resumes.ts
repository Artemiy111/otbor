import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HhAccountId, ResumeId } from "../ids.ts"
import { ResumeEnrichment, ResumeFaqEntry, ResumeRecord, ResumeSalary } from "../models/index.ts"

export const ResumesList = Rpc.make("ResumesList", {
  payload: Schema.Struct({
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Array(ResumeRecord),
  error: ApiError
})

export const ResumeGet = Rpc.make("ResumeGet", {
  payload: Schema.Struct({ id: ResumeId }),
  success: ResumeRecord,
  error: ApiError
})

export const ResumeUpsert = Rpc.make("ResumeUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(ResumeId),
    hhAccountId: HhAccountId,
    source: Schema.optional(Schema.String),
    externalId: Schema.String,
    title: Schema.String,
    text: Schema.String,
    about: Schema.optional(Schema.String),
    skills: Schema.optional(Schema.Array(Schema.String)),
    experience: Schema.optional(Schema.Unknown),
    education: Schema.optional(Schema.Unknown),
    workFormats: Schema.optional(Schema.Array(Schema.String)),
    salaryAmount: Schema.optional(Schema.NullOr(Schema.Int)),
    salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(Schema.NullOr(Schema.String)),
    areaName: Schema.optional(Schema.NullOr(Schema.String)),
    relocation: Schema.optional(Schema.NullOr(Schema.String)),
    businessTripReadiness: Schema.optional(Schema.NullOr(Schema.String)),
    travelTime: Schema.optional(Schema.NullOr(Schema.String)),
    englishLevel: Schema.optional(Schema.NullOr(Schema.String)),
    isActive: Schema.optional(Schema.Boolean),
    lastSeenAt: Schema.optional(Schema.String)
  }),
  success: ResumeRecord,
  error: ApiError
})

export const ResumeEnrichmentGet = Rpc.make("ResumeEnrichmentGet", {
  payload: Schema.Struct({ resumeId: ResumeId }),
  success: ResumeEnrichment,
  error: ApiError
})

export const ResumeEnrichmentSave = Rpc.make("ResumeEnrichmentSave", {
  payload: Schema.Struct({
    resumeId: ResumeId,
    data: Schema.Struct({
      comment: Schema.optional(Schema.String),
      currentlyEmployed: Schema.optional(Schema.NullOr(Schema.Boolean)),
      salaries: Schema.optional(Schema.Array(ResumeSalary)),
      faq: Schema.optional(Schema.Array(ResumeFaqEntry)),
      experience: Schema.optional(
        Schema.Array(
          Schema.Struct({
            key: Schema.String,
            employmentType: Schema.optional(Schema.NullOr(Schema.String)),
            comment: Schema.optional(Schema.NullOr(Schema.String)),
            leaveReason: Schema.optional(Schema.NullOr(Schema.String))
          })
        )
      )
    })
  }),
  success: ResumeEnrichment,
  error: ApiError
})
