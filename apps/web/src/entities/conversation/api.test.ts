import { beforeEach, describe, expect, test } from "bun:test"
import { InvalidInput } from "@otbor/contract"
import { createInboxClient } from "./compat"

/**
 * Клиент вызывает `call(client => client.X(...))`; подмена отдаёт `client`,
 * где каждый вызов ведёт себя как задано в тесте (сервер новый, старый или отказывает).
 */
let handlers: Record<string, () => unknown> = {}
const calls: Array<string> = []

const fakeCall = async (run: (client: never) => unknown) => {
  const client = new Proxy(
    {},
    {
      get: (_target, name: string) => () => {
        calls.push(name)
        const handler = handlers[name]
        if (handler === undefined) throw new Error(`Unknown request tag: ${name}`)
        return handler()
      }
    }
  )
  return run(client as never)
}

const make = () => createInboxClient(fakeCall as never)

const unknownRpc = () => {
  throw new Error("Unknown request tag: ConversationsSearch")
}

const row = (id: string, unreadCount: number) => ({
  id,
  channel: "mail",
  accountId: "a",
  externalId: id,
  title: null,
  url: null,
  personName: null,
  personRole: null,
  lastMessageAt: null,
  unreadCount,
  archived: false,
  lastMessage: null,
  vacancyId: null,
  personId: null
})

describe("conversationApi.search", () => {
  beforeEach(() => {
    calls.length = 0
    handlers = {}
  })

  test("старый сервер: падает на новый вызов, берёт ConversationsList и фильтрует у себя", async () => {
    handlers = { ConversationsSearch: unknownRpc, ConversationsList: () => [row("1", 2), row("2", 0)] }
    const conversationApi = make()
    const page = await conversationApi.search({ unread: true, archived: false })
    expect(page.items.map((item: { id: string }) => item.id)).toEqual(["1"])
    expect(page.unreadTotal).toBe(1)
    // Дальше сразу прежний путь, без новой попытки.
    calls.length = 0
    await conversationApi.search({})
    expect(calls).toEqual(["ConversationsList"])
  })

  test("ошибка по делу не считается признаком старого сервера", async () => {
    handlers = {
      ConversationsSearch: () => {
        throw new InvalidInput({ message: "bad" })
      },
      ConversationsList: () => [row("1", 1)]
    }
    const conversationApi = make()
    await expect(conversationApi.search({})).rejects.toBeDefined()
    expect(calls).toEqual(["ConversationsSearch"])
  })

  test("новый сервер: страница возвращается как есть", async () => {
    const page = { items: [row("1", 1)], total: 7, unreadTotal: 3 }
    handlers = { ConversationsSearch: () => page }
    const conversationApi = make()
    expect(await conversationApi.search({ limit: 1 })).toEqual(page as never)
  })

  test("markRead на старом сервере гасит markAvailable и больше не ходит на сервер", async () => {
    const conversationApi = make()
    const markAvailable = conversationApi.markAvailable
    await expect(conversationApi.markRead("x")).rejects.toThrow()
    expect(markAvailable.value).toBe(false)
    calls.length = 0
    await expect(conversationApi.markRead("x")).rejects.toThrow()
    expect(calls).toEqual([])
  })
})
