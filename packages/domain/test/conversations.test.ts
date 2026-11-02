import { describe, expect, test } from "bun:test"
import { hhChatThreadKey, mailThreadKey, normalizeSubject, telegramThreadKey } from "../src/conversations.ts"

describe("mailThreadKey", () => {
  test("a server thread id wins over headers", () => {
    expect(
      mailThreadKey({
        threadId: "1837",
        references: ["<root@acme.dev>"],
        subject: "Re: Vacancy"
      })
    ).toBe("gm:1837")
  })

  test("the root of the References chain is the thread", () => {
    expect(
      mailThreadKey({
        rfcMessageId: "reply@acme.dev",
        references: ["<root@acme.dev>", "<middle@acme.dev>"],
        inReplyTo: "<middle@acme.dev>",
        subject: "Re: Senior DevOps"
      })
    ).toBe("rfc:root@acme.dev")
  })

  test("In-Reply-To is the fallback when References is absent", () => {
    expect(
      mailThreadKey({
        rfcMessageId: "reply@acme.dev",
        inReplyTo: "<root@acme.dev>",
        subject: "Re: Senior DevOps"
      })
    ).toBe("rfc:root@acme.dev")
  })

  test("a thread without headers falls back to the normalized subject", () => {
    expect(mailThreadKey({ subject: "Re: Fwd: Senior DevOps" })).toBe("subj:senior devops")
    expect(mailThreadKey({ subject: "  RE:  Senior   DevOps " })).toBe("subj:senior devops")
  })

  test("the message id is the last resort, and an empty input stays empty", () => {
    expect(mailThreadKey({ rfcMessageId: "only@acme.dev" })).toBe("rfc:only@acme.dev")
    expect(mailThreadKey({})).toBe("subj:")
  })
})

describe("subject normalization", () => {
  test("reply prefixes are stripped, the body is not", () => {
    expect(normalizeSubject("Re: Senior DevOps")).toBe("senior devops")
    expect(normalizeSubject("Ответ: Senior DevOps")).toBe("senior devops")
    expect(normalizeSubject(null)).toBe("")
  })
})

describe("channel thread keys", () => {
  test("prefixes keep channels apart", () => {
    expect(telegramThreadKey(" 42 ")).toBe("tg:42")
    expect(hhChatThreadKey(" abc ")).toBe("hh:abc")
  })
})
