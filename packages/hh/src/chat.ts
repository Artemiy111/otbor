import { Option, Schema } from "effect"

/**
 * Reads the JSON of `chatik.hh.ru/chatik/api/chat_data?chatId=…`: the chat of
 * one response with its messages. Only the keys otbor uses are described
 * (shape taken from a live response on 2026-11-06); everything else hh ships
 * (resources, participants, vacancy, resume) is ignored. A chat is "unreadable"
 * rather than guessed at when the keys are missing.
 */

const HhId = Schema.Union([Schema.Number, Schema.String])
const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

const HhChatMessage = Schema.Struct({
  id: HhId,
  creationTime: Schema.String,
  text: optional(Schema.String),
  /** "SIMPLE" for people; other values are hh's own notices. */
  type: optional(Schema.String),
  hasContent: optional(Schema.Boolean),
  hidden: optional(Schema.Boolean),
  participantId: optional(HhId),
  participantDisplay: optional(Schema.Struct({ name: optional(Schema.String), isBot: optional(Schema.Boolean) })),
  /** Present on the message that records the response itself. */
  workflowTransition: optional(Schema.Struct({ applicantState: optional(Schema.String) }))
})

const HhChatData = Schema.Struct({
  chat: Schema.Struct({
    id: HhId,
    currentParticipantId: optional(HhId),
    messages: Schema.Struct({ items: Schema.Array(HhChatMessage), hasMore: optional(Schema.Boolean) }),
    resources: optional(Schema.Struct({ VACANCY: optional(Schema.Array(HhId)), RESUME: optional(Schema.Array(HhId)) })),
    lastViewedByOpponentMessageId: optional(HhId)
  })
})

export interface ParsedChatMessage {
  readonly externalId: string
  /** `out`: written by the applicant (the account), `in`: by the recruiter or a bot. */
  readonly direction: "in" | "out"
  readonly sentAt: Date
  /** `service` for hh notices and the response record without text. */
  readonly kind: "text" | "service"
  readonly text: string | null
  readonly authorName: string | null
}

export interface ParsedChat {
  readonly chatId: string
  readonly vacancyExternalId: string | null
  readonly resumeExternalId: string | null
  /** Name of the other side, for the conversation title. */
  readonly personName: string | null
  readonly hasMore: boolean
  readonly messages: ReadonlyArray<ParsedChatMessage>
}

const idOf = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value)

/** `null` when the body is not a chat_data document. */
export const parseChatData = (body: string): ParsedChat | null => {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const decoded = Schema.decodeUnknownOption(HhChatData)(json)
  if (Option.isNone(decoded)) return null
  const { chat } = decoded.value
  const me = idOf(chat.currentParticipantId)

  const messages: Array<ParsedChatMessage> = []
  let personName: string | null = null
  for (const item of chat.messages.items) {
    if (item.hidden === true) continue
    const sentAt = new Date(item.creationTime)
    if (Number.isNaN(sentAt.getTime())) continue
    const mine = me !== null && idOf(item.participantId) === me
    const text = (item.text ?? "").trim()
    const name = item.participantDisplay?.name ?? null
    if (!mine && name !== null && personName === null) personName = name
    messages.push({
      externalId: String(item.id),
      direction: mine ? "out" : "in",
      sentAt,
      kind: item.type !== undefined && item.type !== null && item.type !== "SIMPLE" ? "service" : text === "" ? "service" : "text",
      text: text === "" ? null : text,
      authorName: name
    })
  }
  messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())

  return {
    chatId: String(chat.id),
    vacancyExternalId: idOf(chat.resources?.VACANCY?.[0]),
    resumeExternalId: idOf(chat.resources?.RESUME?.[0]),
    personName,
    hasMore: chat.messages.hasMore === true,
    messages
  }
}
