import { describe, expect, test } from "bun:test"
import type { ConversationSummary } from "@otbor/contract"
import { legacySearch, patchInboxPages, unreadByPerson, unreadDelta } from "./model"

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

describe("legacySearch", () => {
  const rows = [
    conversation({ id: "1", unreadCount: 2, channel: "mail", title: "Оффер", lastMessage: "привет" } as never),
    conversation({ id: "2", unreadCount: 0, channel: "telegram", personName: "Борис" } as never),
    conversation({ id: "3", unreadCount: 1, channel: "mail", archived: true } as never)
  ]

  test("фильтры, поиск и страница", () => {
    expect(legacySearch(rows, { archived: false }).total).toBe(2)
    expect(legacySearch(rows, { archived: false, unread: true }).items.map((i) => i.id as string)).toEqual(["1"])
    expect(legacySearch(rows, { search: "борис" }).items.map((i) => i.id as string)).toEqual(["2"])
    expect(legacySearch(rows, { channel: "mail", archived: false }).unreadTotal).toBe(1)
    const page = legacySearch(rows, { limit: 1, offset: 1 })
    expect(page.items.map((i) => i.id as string)).toEqual(["2"])
    expect(page.total).toBe(3)
  })
})

describe("patchInboxPages", () => {
  const page = (items: ReturnType<typeof conversation>[], unreadTotal: number) => ({ items, total: 2, unreadTotal })
  const data = {
    pages: [
      page([conversation({ id: "1", unreadCount: 3 })], 1),
      page([conversation({ id: "2", unreadCount: 0 })], 1)
    ]
  }

  test("прочитанным: счётчик в строке и unreadTotal на всех страницах уменьшаются", () => {
    const next = patchInboxPages(data, "1", 0)
    expect(next.pages[0]!.items[0]!.unreadCount).toBe(0)
    expect(next.pages.map((p) => p.unreadTotal)).toEqual([0, 0])
    expect(next.pages[0]!.total).toBe(2)
  })

  test("непрочитанным: unreadTotal растёт; повтор и чужой id ничего не меняют", () => {
    expect(patchInboxPages(data, "2", 1).pages.map((p) => p.unreadTotal)).toEqual([2, 2])
    expect(patchInboxPages(data, "1", 3)).toBe(data)
    expect(patchInboxPages(data, "zzz", 0)).toBe(data)
  })

  test("unreadDelta: архивные не считаются", () => {
    expect(unreadDelta(2, 0, false)).toBe(-1)
    expect(unreadDelta(0, 1, false)).toBe(1)
    expect(unreadDelta(2, 5, false)).toBe(0)
    expect(unreadDelta(2, 0, true)).toBe(0)
  })
})
