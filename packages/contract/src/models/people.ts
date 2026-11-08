import { Schema } from "effect"
import { EmployerId, PersonId, ResumeId, VacancyId } from "../ids.ts"
import { ContactRecord, ConversationSummary } from "./contacts.ts"

/**
 * A human counterparty (recruiter, hiring manager). A person owns several
 * contact identities and conversations across channels.
 */
export const PersonSummary = Schema.Struct({
  id: PersonId,
  displayName: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  employerId: Schema.NullOr(EmployerId),
  contactCount: Schema.Int,
  conversationCount: Schema.Int,
  lastSeenAt: Schema.NullOr(Schema.String)
})

export type PersonSummary = typeof PersonSummary.Type

export const PersonRecord = Schema.Struct({
  ...PersonSummary.fields,
  notes: Schema.NullOr(Schema.String),
  contacts: Schema.Array(ContactRecord),
  conversations: Schema.Array(ConversationSummary),
  vacancyIds: Schema.Array(VacancyId),
  resumeIds: Schema.Array(ResumeId)
})

export type PersonRecord = typeof PersonRecord.Type

/** Two people that look like one human, but no sure signal allows an automatic merge. */
export const PersonMergeSuggestion = Schema.Struct({
  a: PersonId,
  b: PersonId,
  reason: Schema.String
})

export type PersonMergeSuggestion = typeof PersonMergeSuggestion.Type

/** What a re-link run did; counters only, the data is read through PersonList. */
export const PeopleRelinkResult = Schema.Struct({
  conversations: Schema.Int,
  peopleCreated: Schema.Int,
  contactsLinked: Schema.Int,
  vacancyLinks: Schema.Int,
  resumeLinks: Schema.Int,
  mergeSuggestions: Schema.Array(PersonMergeSuggestion)
})

export type PeopleRelinkResult = typeof PeopleRelinkResult.Type
