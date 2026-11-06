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

describe("parseChatData", () => {
  it("reads direction, kind and the other side", () => {
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

  it("is null for anything that is not a chat", () => {
    expect(parseChatData("<html>login</html>")).toBeNull()
    expect(parseChatData("{}")).toBeNull()
  })
})
