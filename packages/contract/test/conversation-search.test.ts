import { describe, expect, test } from "bun:test"
import {
  ConversationListItem,
  ConversationMarkRead,
  ConversationMessageRecord,
  ConversationSearchResult,
  ConversationsSearch
} from "@otbor/contract"
import { Schema } from "effect"

const item = {
  id: "0195a000-0000-7000-8000-000000000001",
  channel: "hh_chat",
  accountId: "acc",
  externalId: "ext",
  title: null,
  url: null,
  personName: "Анна",
  personRole: null,
  lastMessageAt: "2026-11-10T10:00:00.000Z",
  unreadCount: 2,
  archived: false,
  lastMessage: "Привет",
  vacancyId: null,
  personId: null,
  vacancyTitle: "Senior SRE",
  employerName: "Acme",
  hhAccountId: "acc",
  readAt: null
}

describe("ConversationsSearch contract", () => {
  test("результат с итогами декодируется", () => {
    const decoded = Schema.decodeUnknownSync(ConversationSearchResult)({ items: [item], total: 10, unreadTotal: 3 })
    expect(decoded.total).toBe(10)
    expect(decoded.items[0]!.vacancyTitle).toBe("Senior SRE")
  })

  test("строка без полей контекста не декодируется, сообщение без отправителя декодируется", () => {
    const { vacancyTitle: _omit, ...broken } = item
    expect(() => Schema.decodeUnknownSync(ConversationListItem)(broken)).toThrow()
    const message = Schema.decodeUnknownSync(ConversationMessageRecord)({
      id: "m", externalId: "e", direction: "in", sentAt: "2026-11-10T10:00:00.000Z", kind: "text", text: null, readAt: null
    })
    expect(message.senderName).toBeUndefined()
  })

  test("payload: все поля необязательны, лишние типы отвергаются", () => {
    const payload = Schema.Struct(ConversationsSearch.payloadSchema.fields)
    expect(Schema.decodeUnknownSync(payload)({})).toEqual({})
    expect(Schema.decodeUnknownSync(payload)({ search: "x", unread: true, channel: "mail", limit: 20, offset: 40 }).offset).toBe(40)
    expect(() => Schema.decodeUnknownSync(payload)({ unread: "yes" })).toThrow()
    expect(ConversationMarkRead._tag).toBe("ConversationMarkRead")
  })
})
