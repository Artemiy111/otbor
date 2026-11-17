import { Option, Schema } from "effect"

/**
 * Читает JSON `chatik.hh.ru/chatik/api/chat_data?chatId=…`: чат одного отклика
 * с его сообщениями. Описаны только ключи, которые использует otbor (формат
 * снят с живого ответа 2026-11-06); остальное, что присылает hh, игнорируется.
 * Чат без обязательных ключей считается нечитаемым, а не угадывается.
 */

const HhId = Schema.Union([Schema.Number, Schema.String])
const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

/** Кнопки-варианты ответа, которые hh прикладывает к сообщению. */
const HhChatActions = Schema.Struct({
  text_buttons: optional(
    Schema.Array(Schema.Struct({ text: optional(Schema.String) }))
  )
})

const HhChatMessage = Schema.Struct({
  id: HhId,
  creationTime: Schema.String,
  text: optional(Schema.String),
  /** `"SIMPLE"` — сообщение от человека, остальные значения — служебные уведомления hh. */
  type: optional(Schema.String),
  hasContent: optional(Schema.Boolean),
  hidden: optional(Schema.Boolean),
  participantId: optional(HhId),
  participantDisplay: optional(
    Schema.Struct({ name: optional(Schema.String), isBot: optional(Schema.Boolean) })
  ),
  /** `actions` может содержать что угодно, поэтому разбираем кнопки отдельно. */
  actions: Schema.optional(Schema.Unknown),
  /** Есть у сообщения, которое фиксирует сам отклик. */
  workflowTransition: optional(Schema.Struct({ applicantState: optional(Schema.String) }))
})

const HhChatData = Schema.Struct({
  chat: Schema.Struct({
    id: HhId,
    currentParticipantId: optional(HhId),
    messages: Schema.Struct({ items: Schema.Array(HhChatMessage), hasMore: optional(Schema.Boolean) }),
    resources: optional(
      Schema.Struct({
        VACANCY: optional(Schema.Array(HhId)),
        RESUME: optional(Schema.Array(HhId))
      })
    ),
    lastViewedByOpponentMessageId: optional(HhId)
  })
})

export interface ParsedChatMessage {
  readonly externalId: string
  /** `out` — сообщение аккаунта, `in` — работодателя или бота. */
  readonly direction: "in" | "out"
  readonly sentAt: Date
  /** `service` — служебные уведомления hh и запись об отклике без текста. */
  readonly kind: "text" | "service"
  readonly text: string | null
  readonly authorName: string | null
  /** Id участника внутри чата; между чатами не стабилен, идентичностью не служит. */
  readonly authorId: string | null
  /** Признак бота, который сообщил hh; `null`, если поле отсутствует. */
  readonly isBot: boolean | null
  /** Тексты кнопок-вариантов ответа, если hh приложил их к сообщению. */
  readonly replyOptions: ReadonlyArray<string>
}

export interface ParsedChat {
  readonly chatId: string
  readonly vacancyExternalId: string | null
  readonly resumeExternalId: string | null
  /** Имя второй стороны, для заголовка диалога. */
  readonly personName: string | null
  readonly hasMore: boolean
  readonly messages: ReadonlyArray<ParsedChatMessage>
}

const idOf = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value)

/**
 * Достаёт тексты кнопок из `actions`. Неверная форма `actions` не делает чат
 * нечитаемым: в этом случае просто считаем, что кнопок нет.
 */
const replyOptionsOf = (actions: unknown): ReadonlyArray<string> => {
  const parsed = Option.getOrElse(
    Schema.decodeUnknownOption(HhChatActions)(actions ?? {}),
    () => ({ text_buttons: undefined })
  )
  const buttons = parsed.text_buttons ?? []
  return buttons.flatMap((button) => {
    const text = button.text?.trim()
    return text === undefined || text === "" ? [] : [text]
  })
}

/** `null`, когда тело не является документом chat_data. */
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
      kind:
        item.type !== undefined && item.type !== null && item.type !== "SIMPLE"
          ? "service"
          : text === ""
            ? "service"
            : "text",
      text: text === "" ? null : text,
      authorName: name,
      authorId: idOf(item.participantId),
      isBot: item.participantDisplay?.isBot ?? null,
      replyOptions: replyOptionsOf(item.actions)
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
