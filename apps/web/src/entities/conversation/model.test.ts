import { describe, expect, test } from "bun:test"
import type { ConversationSummary } from "@otbor/contract"
import { unreadByPerson } from "./model"

const conversation = (patch: Omit<Partial<ConversationSummary>, "id"> & { id: string }): ConversationSummary =>
  ({ archived: false, unreadCount: 0, personId: null, ...patch }) as ConversationSummary

describe("unreadByPerson", () => {
  test("суммирует непрочитанные по человеку", () => {
    const map = unreadByPerson([
      conversation({ id: "1", personId: "p1" as never, unreadCount: 2 }),
      conversation({ id: "2", personId: "p1" as never, unreadCount: 1 }),
      conversation({ id: "3", personId: "p2" as never }),
      conversation({ id: "4", unreadCount: 5 })
    ])
    expect(map.get("p1")).toBe(3)
    expect(map.has("p2")).toBe(false)
  })
})
