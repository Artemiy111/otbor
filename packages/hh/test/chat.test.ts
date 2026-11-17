import { describe, expect, it } from "bun:test"
import { parseChatData } from "../src/index.ts"

const sample = JSON.stringify({
  chat: {
    id: 5772244059,
    currentParticipantId: "159847761",
    resources: { VACANCY: ["119878927"], RESUME: ["289972366"] },
    messages: {
      hasMore: false,
      items: [
        {
          id: 16145693512,
          creationTime: "2026-11-06T14:39:41.344167+03:00",
          text: "",
          type: "SIMPLE",
          hasContent: false,
          hidden: false,
          participantId: "159847761",
          participantDisplay: { name: "Герман Воробцов", isBot: false },
          workflowTransition: { applicantState: "RESPONSE" }
        },
        {
          id: 16147923299,
          creationTime: "2026-11-06T16:45:52.712018+03:00",
          text: "Герман, добрый день!\nСпасибо за отклик",
          type: "SIMPLE",
          hasContent: true,
          hidden: false,
          participantId: "135877243",
          participantDisplay: { name: "Александра", isBot: false }
        }
      ]
    }
  }
})

/** Сообщение робота-рекрутера с кнопками-вариантами ответа. */
const botSample = JSON.stringify({
  chat: {
    id: 42,
    currentParticipantId: "me",
    resources: { VACANCY: ["100"], RESUME: ["200"] },
    messages: {
      hasMore: false,
      items: [
        {
          id: 1,
          creationTime: "2026-11-17T10:00:00+03:00",
          text: "Какой у вас опыт с Kubernetes?",
          type: "SIMPLE",
          hidden: false,
          participantId: "bot-1",
          participantDisplay: { name: "Робот-рекрутер", isBot: true },
          actions: {
            text_buttons: [
              { text: "Более 3 лет" },
              { text: "1-3 года" },
              { text: "" }
            ]
          }
        },
        {
          id: 2,
          creationTime: "2026-11-17T10:01:00+03:00",
          text: "Более 3 лет",
          type: "SIMPLE",
          hidden: false,
          participantId: "me",
          participantDisplay: { name: "Герман", isBot: false },
          actions: "неверная форма"
        }
      ]
    }
  }
})

describe("parseChatData", () => {
  it("читает направление, вид и вторую сторону", () => {
    const chat = parseChatData(sample)
    expect(chat?.chatId).toBe("5772244059")
    expect(chat?.vacancyExternalId).toBe("119878927")
    expect(chat?.personName).toBe("Александра")
    expect(chat?.messages.map((m) => [m.direction, m.kind])).toEqual([
      ["out", "service"],
      ["in", "text"]
    ])
    expect(chat?.messages[1]?.text).toContain("добрый день")
  })

  it("сохраняет признак бота и id участника", () => {
    const chat = parseChatData(sample)
    expect(chat?.messages[0]?.authorId).toBe("159847761")
    expect(chat?.messages[0]?.isBot).toBe(false)
    expect(chat?.messages[1]?.authorId).toBe("135877243")
    expect(chat?.messages[1]?.isBot).toBe(false)
    expect(chat?.messages[0]?.replyOptions).toEqual([])
  })

  it("сохраняет признак бота и кнопки ответа, когда они есть", () => {
    const chat = parseChatData(botSample)
    expect(chat?.personName).toBe("Робот-рекрутер")
    expect(chat?.messages[0]?.isBot).toBe(true)
    expect(chat?.messages[0]?.authorId).toBe("bot-1")
    expect(chat?.messages[0]?.replyOptions).toEqual(["Более 3 лет", "1-3 года"])
    expect(chat?.messages[1]?.isBot).toBe(false)
    // Неверная форма actions не ломает разбор: считаем, что кнопок нет.
    expect(chat?.messages[1]?.replyOptions).toEqual([])
  })

  it("не считает чатом всё, что не является chat_data", () => {
    expect(parseChatData("<html>login</html>")).toBeNull()
    expect(parseChatData("{}")).toBeNull()
  })
})
