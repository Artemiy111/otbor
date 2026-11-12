import { describe, expect, test } from "bun:test"
import type { ConversationMessageRecord, ConversationSummary } from "@otbor/contract"
import {
  conversationLines,
  countUnread,
  filterConversations,
  groupMessagesByDay,
  inboxHref,
  linkify,
  neighbourId,
  parseContactsView,
  parseInboxState,
  relativeTime,
  sortConversations
} from "./inbox"

const conversation = (patch: Omit<Partial<ConversationSummary>, "id"> & { id: string }): ConversationSummary =>
  ({
    channel: "mail",
    accountId: "a",
    externalId: patch.id,
    title: null,
    url: null,
    personName: null,
    personRole: null,
    lastMessageAt: null,
    unreadCount: 0,
    archived: false,
    lastMessage: null,
    vacancyId: null,
    personId: null,
    ...patch
  }) as ConversationSummary

const message = (id: string, sentAt: Date): ConversationMessageRecord =>
  ({
    id,
    externalId: id,
    direction: "in",
    sentAt: sentAt.toISOString(),
    kind: "text",
    text: id,
    readAt: null
  }) as ConversationMessageRecord

describe("parseInboxState / inboxHref", () => {
  test("пустой адрес - значения по умолчанию", () => {
    expect(parseInboxState("")).toEqual({ conversation: null, filter: "all", channel: "all" })
  })

  test("читает диалог, фильтр и канал", () => {
    expect(parseInboxState("?c=abc&filter=unread&channel=telegram")).toEqual({
      conversation: "abc",
      filter: "unread",
      channel: "telegram"
    })
  })

  test("неизвестные значения игнорируются", () => {
    expect(parseInboxState("?filter=weird&channel=sms&c=")).toEqual({
      conversation: null,
      filter: "all",
      channel: "all"
    })
  })

  test("обратное преобразование не пишет значения по умолчанию", () => {
    expect(inboxHref({ conversation: null, filter: "all", channel: "all" })).toBe("/contacts")
    expect(inboxHref({ conversation: "x", filter: "unread", channel: "hh_chat" })).toBe(
      "/contacts?c=x&filter=unread&channel=hh_chat"
    )
  })

  test("состояние переживает круг адрес -> состояние -> адрес", () => {
    const href = "/contacts?c=x&filter=unread&channel=mail"
    expect(inboxHref(parseInboxState(href.slice("/contacts".length)))).toBe(href)
  })

  test("view=contacts открывает таблицу контактов", () => {
    expect(parseContactsView("?view=contacts")).toBe("contacts")
    expect(parseContactsView("?c=1")).toBe("inbox")
  })
})

describe("sortConversations", () => {
  test("непрочитанные выше, внутри групп свежие выше, без даты - в конце", () => {
    const sorted = sortConversations([
      conversation({ id: "old-read", lastMessageAt: "2026-01-01T10:00:00Z" }),
      conversation({ id: "new-read", lastMessageAt: "2026-03-01T10:00:00Z" }),
      conversation({ id: "old-unread", unreadCount: 1, lastMessageAt: "2026-01-02T10:00:00Z" }),
      conversation({ id: "new-unread", unreadCount: 3, lastMessageAt: "2026-02-02T10:00:00Z" }),
      conversation({ id: "no-date" })
    ])
    expect(sorted.map((item) => item.id as string)).toEqual([
      "new-unread",
      "old-unread",
      "new-read",
      "old-read",
      "no-date"
    ])
  })

  test("не меняет исходный массив", () => {
    const input = [conversation({ id: "b" }), conversation({ id: "a", unreadCount: 1 })]
    sortConversations(input)
    expect(input[0]?.id as string).toBe("b")
  })
})

describe("filterConversations", () => {
  const items = [
    conversation({ id: "1", unreadCount: 2, channel: "mail", personName: "Анна Рекрутер" }),
    conversation({ id: "2", channel: "telegram", lastMessage: "Привет, есть вакансия" }),
    conversation({ id: "3", channel: "hh_chat", unreadCount: 1, archived: true }),
    conversation({ id: "4", channel: "hh_chat", vacancyId: "v1" as never })
  ]

  test("архивные не показываются", () => {
    expect(filterConversations(items, { filter: "all", channel: "all", text: "" }).map((i) => i.id as string)).toEqual([
      "1",
      "2",
      "4"
    ])
  })

  test("непрочитанные и канал", () => {
    expect(filterConversations(items, { filter: "unread", channel: "all", text: "" }).map((i) => i.id as string)).toEqual(["1"])
    expect(filterConversations(items, { filter: "all", channel: "telegram", text: "" }).map((i) => i.id as string)).toEqual(["2"])
  })

  test("поиск по имени и тексту последнего сообщения без учёта регистра", () => {
    const run = (text: string) =>
      filterConversations(items, {
        filter: "all",
        channel: "all",
        text,
      }).map((i) => i.id as string)
    expect(run("анна")).toEqual(["1"])
    expect(run("ВАКАНСИЯ")).toEqual(["2"])
  })

  test("счётчик непрочитанных не считает архив", () => {
    expect(countUnread(items)).toBe(1)
  })
})

describe("neighbourId", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }]

  test("двигается по списку и упирается в края", () => {
    expect(neighbourId(items, "b", 1)).toBe("c")
    expect(neighbourId(items, "c", 1)).toBe("c")
    expect(neighbourId(items, "a", -1)).toBe("a")
  })

  test("без выбора берёт край списка", () => {
    expect(neighbourId(items, null, 1)).toBe("a")
    expect(neighbourId(items, "missing", -1)).toBe("c")
    expect(neighbourId([], null, 1)).toBeNull()
  })
})

describe("groupMessagesByDay", () => {
  const now = new Date(2026, 5, 10, 15, 0)

  test("группирует по дню, сортирует по времени и подписывает дни", () => {
    const days = groupMessagesByDay(
      [
        message("c", new Date(2026, 5, 10, 9, 0)),
        message("a", new Date(2026, 5, 8, 12, 0)),
        message("b", new Date(2026, 5, 9, 23, 59)),
        message("d", new Date(2026, 5, 10, 9, 30))
      ],
      now
    )
    expect(days.map((day) => day.label)).toEqual(["8 июня", "Вчера", "Сегодня"])
    expect(days.map((day) => day.messages.map((m) => m.id as string))).toEqual([["a"], ["b"], ["c", "d"]])
  })

  test("другой год подписывается с годом", () => {
    const [day] = groupMessagesByDay([message("a", new Date(2025, 11, 31, 12, 0))], now)
    expect(day?.label).toBe("31 декабря 2025")
  })

  test("пустой список даёт пустой результат", () => {
    expect(groupMessagesByDay([], now)).toEqual([])
  })
})

describe("relativeTime", () => {
  const now = new Date(2026, 5, 10, 15, 0)

  test("минуты, время сегодня, вчера, дата, другой год", () => {
    expect(relativeTime(new Date(2026, 5, 10, 14, 59, 30).toISOString(), now)).toBe("сейчас")
    expect(relativeTime(new Date(2026, 5, 10, 14, 40).toISOString(), now)).toBe("20 мин")
    expect(relativeTime(new Date(2026, 5, 10, 9, 5).toISOString(), now)).toBe("09:05")
    expect(relativeTime(new Date(2026, 5, 9, 23, 0).toISOString(), now)).toBe("вчера")
    expect(relativeTime(new Date(2026, 4, 5, 12, 0).toISOString(), now)).toBe("5 мая")
    expect(relativeTime(new Date(2025, 9, 5, 12, 0).toISOString(), now)).toBe("05.10.2025")
    expect(relativeTime(null, now)).toBe("")
  })
})

describe("linkify", () => {
  test("находит ссылки и не забирает знаки препинания", () => {
    expect(linkify("Смотри https://hh.ru/vacancy/1, потом (http://a.b/c).")).toEqual([
      { kind: "text", value: "Смотри " },
      { kind: "link", value: "https://hh.ru/vacancy/1", href: "https://hh.ru/vacancy/1" },
      { kind: "text", value: ", потом (" },
      { kind: "link", value: "http://a.b/c", href: "http://a.b/c" },
      { kind: "text", value: ")." }
    ])
  })

  test("не создаёт ссылок из других схем", () => {
    expect(linkify("javascript:alert(1)")).toEqual([{ kind: "text", value: "javascript:alert(1)" }])
  })
})

describe("conversationLines", () => {
  const base = { personName: null, personRole: null, title: null, vacancyTitle: null, employerName: null }
  test("уведомление hh называется по работодателю, вакансия уходит во вторую строку", () => {
    expect(conversationLines({ ...base, personName: "hh.ru", title: "Вакансия закрыта", vacancyTitle: "DevOps Engineer", employerName: "Lamoda Tech" }))
      .toEqual({ headline: "Lamoda Tech", context: "DevOps Engineer · через hh.ru" })
  })
  test("без вакансии заголовком становится тема письма", () => {
    expect(conversationLines({ ...base, personName: "hh.ru", title: "Новое сообщение от работодателя" }))
      .toEqual({ headline: "Новое сообщение от работодателя", context: "через hh.ru" })
  })
  test("человек остаётся заголовком, вакансия и работодатель - контекстом", () => {
    expect(conversationLines({ ...base, personName: "Анна Петрова", personRole: "HR", vacancyTitle: "SRE", employerName: "Яндекс" }))
      .toEqual({ headline: "Анна Петрова", context: "SRE · Яндекс" })
  })
  test("только сервис: заголовок - его имя, второй строки нет", () => {
    expect(conversationLines({ ...base, personName: "hh.ru", title: "hh.ru" })).toEqual({ headline: "hh.ru", context: null })
    expect(conversationLines(base)).toEqual({ headline: "Без названия", context: null })
  })
})
