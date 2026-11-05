import { Schema } from "effect"

/**
 * One entry of `applicantNegotiations.topicList` on `/applicant/negotiations`:
 * hh's "topic", the record of one response (or invitation) of one resume to one
 * vacancy. The shape below is the whole entry as a logged-in page ships it
 * (read from a live page on 2026-11-05, 55 keys), not only what otbor needs.
 *
 * Every key is optional and nullable on purpose: hh adds, drops and nulls keys
 * without notice, and one surprise must not make the whole list "unreadable".
 * Fields we read are marked USED and say what they feed; everything else is
 * unused today and only documents the shape. Ids are numbers on the live page
 * and strings in older exports, so ids accept both.
 *
 * Entities that hh keeps per resume: a vacancy answered with two resumes has
 * two topics, each with its own `id` and its own `chatId`.
 */

const HhId = Schema.Union([Schema.Number, Schema.String])
const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

/** `communicationContext.chatData`: the chat the topic lives in. */
const HhChatData = Schema.Struct({
  id: optional(HhId), // unused: same value as `chatId`
  type: optional(Schema.String), // unused: "NEGOTIATION" on every topic seen
  subtype: optional(Schema.String) // unused: null on every topic seen
})

const HhCommunicationContext = Schema.Struct({
  chatData: optional(HhChatData)
})

/** `resources`: the vacancy and the resume of the topic, in no fixed order. */
const HhResource = Schema.Struct({
  id: optional(HhId), // unused: `vacancyId` and `resumeId` already say it
  type: optional(Schema.String) // unused: "VACANCY" | "RESUME"
})

/** `actions`: the buttons hh offers on the list row. Never invoked by otbor. */
const HhTopicAction = Schema.Struct({
  name: optional(Schema.String), // unused: "decline" | "delete" | "feedback"
  method: optional(Schema.String), // unused
  href: optional(Schema.String), // unused
  substate: optional(Schema.String) // unused
})

export const HhNegotiationTopic = Schema.Struct({
  /** unused: hh's topic id. Distinct from `chatId`; kept for a future "open this topic" link. */
  id: optional(HhId),
  /** unused: the applicant's hh user id. */
  applicantUserId: optional(HhId),
  /** unused: employer id. The employer comes from the vacancy, not from here. */
  employerId: optional(HhId),
  /** unused: the recruiter who handles the topic. */
  employerManagerId: optional(HhId),
  /** USED: the chat of this response. One per resume; the only way to address a single response. */
  chatId: optional(HhId),
  /** unused: `chatId` again, nested. */
  communicationContext: optional(HhCommunicationContext),

  /** USED (fallback): the state the topic started in, "RESPONSE" for an applicant response. */
  initialState: optional(Schema.String),
  /** unused: employer-side state at the start. */
  initialEmployerState: optional(Schema.String),
  /** USED: the current state, becomes the application's `hh_status` ("RESPONSE", "DISCARD", "INVITATION"...). */
  lastState: optional(Schema.String),
  /** USED: employer-side state, for the reconcile reading. */
  lastEmployerState: optional(Schema.String),
  /** unused: extended name of the employer-side state. */
  lastEmployerStateExtName: optional(Schema.String),
  /** unused: hiring funnel stage. */
  lastFunnelStage: optional(Schema.String),
  /** USED: the topic was moved to hh's archive. */
  archived: optional(Schema.Boolean),

  /** USED (fallback): when the response was made, if `lastModified` is missing. */
  creationTime: optional(Schema.Unknown),
  /** unused: the platform the response came from. */
  platform: optional(Schema.String),
  /** unused: whether the applicant asked a question instead of responding. */
  applicantQuestionState: optional(Schema.Boolean),
  /** unused: "RESPONSE_BY_APPLICANT", "INVITATION_BY_EMPLOYER"... at the start. */
  initialTopicType: optional(Schema.String),
  /** unused: the same, now. */
  currentTopicType: optional(Schema.String),
  /** unused: grouping of `initialTopicType`. */
  initialTopicTypeGroups: optional(Schema.Array(Schema.String)),
  /** unused: grouping of `currentTopicType`. */
  currentTopicTypeGroups: optional(Schema.Array(Schema.String)),
  /** USED: why the employer turned the response down ("DISCARD_BY_EMPLOYER"). */
  discardReason: optional(Schema.String),
  /** unused: a cover letter was attached to the response. A future check for "letter already sent". */
  hasResponseLetter: optional(Schema.Boolean),
  /** USED: the last substate ("SHOW", "HIDE"...). */
  lastSubState: optional(Schema.String),
  /** unused: the applicant-side substate. */
  applicantSubState: optional(Schema.String),
  /** unused: the employer-side substate ("NEW"...). */
  employerSubState: optional(Schema.String),
  /** unused: the topic has any message text. */
  hasText: optional(Schema.Boolean),
  /** unused: the employer opened the response. */
  viewedByOpponent: optional(Schema.Boolean),
  /** unused: unread messages for the applicant. */
  hasNewMessages: optional(Schema.Boolean),

  /** USED: last change, ISO string with offset. First choice for the response date. */
  lastModified: optional(Schema.Unknown),
  /** unused: `lastModified` in epoch milliseconds. */
  lastModifiedMillis: optional(Schema.Number),
  /** unused: the chat was archived. */
  chatIsArchived: optional(Schema.Boolean),
  /** unused: `creationTime` in epoch milliseconds. */
  creationTimeMillis: optional(Schema.Number),
  /** unused: when the employer created their side of the topic. */
  employerCreationTime: optional(Schema.Unknown),
  /** unused: employer's last change. */
  employerLastChangeTime: optional(Schema.Unknown),
  /** unused: last change not counting the employer's inbox. */
  lastChangeDateTimeExceptEmployerInbox: optional(Schema.Unknown),
  /** unused: messages in the chat. */
  conversationMessagesCount: optional(Schema.Number),
  /** unused: messages the employer has not read. */
  conversationUnreadByEmployerCount: optional(Schema.Number),
  /** unused: whether the employer can write first ("AVAILABLE", "WITHOUT_INVITATION"). */
  inboxAvailabilityState: optional(Schema.String),
  /** unused: whether hh allows a reminder to the employer. */
  responseReminderState: optional(Schema.Struct({ allowed: optional(Schema.Boolean) })),
  /** unused: "NEGOTIATION" on every topic seen. */
  topicSource: optional(Schema.String),
  /** unused: the applicant may decline an invitation. */
  declineByApplicantAllowed: optional(Schema.Boolean),
  /** unused: the applicant declined. */
  declinedByApplicant: optional(Schema.Boolean),
  /** unused: hh flagged the employer for breaking its rules. */
  employerViolatesRules: optional(Schema.Boolean),
  /** unused: funnel stage as the applicant sees it. */
  applicantStateInfo: optional(Schema.Struct({ funnelStageKey: optional(Schema.String) })),

  /** USED: hh's numeric vacancy id. A topic without it makes the page unreadable. */
  vacancyId: optional(HhId),
  /** USED: hh's numeric id of the resume the response was made with. */
  resumeId: optional(HhId),
  /** unused: `vacancyId` and `resumeId` again, as a list. */
  resources: optional(Schema.Array(HhResource)),
  /** unused: states the topic can move to by the applicant's action. */
  availableTransitions: optional(Schema.Array(Schema.Unknown)),
  /** unused: funnel stages available to the topic. */
  availableStages: optional(Schema.Array(Schema.Unknown)),
  /** unused: AI interview invitation, if any. */
  aiInterview: optional(Schema.Unknown),
  /** unused: row buttons. */
  actions: optional(Schema.Array(HhTopicAction)),
  /** unused: hh offers an AI summary of the vacancy. */
  applicantVacancySummaryEnabled: optional(Schema.Boolean),
  /** unused: a survey about an automatic action is waiting. */
  hasPendingAutoActionSurvey: optional(Schema.Boolean),

  // Keys older exports and our synthetic fixtures use. A live page does not
  // ship them; they are read only as fallbacks so those pages still parse.

  /** USED (legacy fallback): employer name when the entry carries one. */
  employerName: optional(Schema.String),
  /** USED (legacy fallback): the same under another name. */
  companyName: optional(Schema.String),
  /** USED (legacy fallback): nested employer. */
  employer: optional(Schema.Struct({ name: optional(Schema.String) })),
  /** USED (legacy fallback): vacancy title when the entry carries one. */
  vacancyName: optional(Schema.String),
  /** USED (legacy fallback): the same under another name. */
  vacancyTitle: optional(Schema.String),
  /** USED (legacy fallback): nested resume. */
  resume: optional(Schema.Struct({ id: optional(HhId), resumeId: optional(HhId) })),
  /** USED (legacy fallback): date keys older exports use instead of `lastModified`. */
  lastChangeTime: optional(Schema.Unknown),
  /** USED (legacy fallback). */
  lastStateChangeTime: optional(Schema.Unknown),
  /** USED (legacy fallback). */
  updateTime: optional(Schema.Unknown)
})

export type HhNegotiationTopic = typeof HhNegotiationTopic.Type
