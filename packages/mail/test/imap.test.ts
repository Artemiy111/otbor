import { describe, expect, test } from "bun:test"
import { parseFetchedMessage, syntheticMessageId, type ImapFetchItem } from "../src/index.ts"

const rawMessage = [
  "From: HR Team <HR@Example.COM>",
  "To: Ivan Petrov <IVAN@Example.com>, second@example.com",
  "Cc: Boss <Boss@Example.com>",
  "Subject: Interview invitation",
  "Message-ID: <abc.123@example.com>",
  "In-Reply-To: <root@example.com>",
  "References: <root@example.com> <second@example.com>",
  "List-Id: Acme Jobs <jobs.acme.example>",
  "Authentication-Results: mx.example; spf=pass",
  "Date: Fri, 30 Oct 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello Ivan,",
  "",
  "Your interview is confirmed.",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Hello <b>Ivan</b>,</p><p>HTML only copy</p>",
  "--inner--",
  "--outer",
  'Content-Type: application/pdf; name="cv.pdf"',
  'Content-Disposition: attachment; filename="cv.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--outer--",
  ""
].join("\r\n")

const received = new Date("2026-10-30T10:05:00.000Z")

const item = (overrides: Partial<ImapFetchItem> = {}): ImapFetchItem => ({
  uid: 7,
  source: Buffer.from(rawMessage),
  size: rawMessage.length,
  internalDate: received,
  envelope: {
    date: new Date("2026-10-30T10:00:00.000Z"),
    subject: "envelope subject",
    messageId: "<envelope@example.com>",
    from: [{ name: "HR Team", address: "hr@example.com" }],
    to: [{ name: "Ivan Petrov", address: "ivan@example.com" }],
    cc: []
  },
  ...overrides
})

describe("parseFetchedMessage", () => {
  test("parses headers, addresses and the text/plain body", async () => {
    const message = await parseFetchedMessage("INBOX", item({ threadId: "9001" }), "me@example.com")

    expect(message).not.toBeNull()
    if (!message) return
    expect(message.folder).toBe("INBOX")
    expect(message.uid).toBe(7)
    expect(message.threadId).toBe("9001")
    expect(message.rfcMessageId).toBe("abc.123@example.com")
    expect(message.inReplyTo).toBe("root@example.com")
    expect(message.references).toEqual(["root@example.com", "second@example.com"])
    expect(message.from).toEqual([{ name: "HR Team", address: "hr@example.com" }])
    expect(message.to).toEqual([
      { name: "Ivan Petrov", address: "ivan@example.com" },
      { name: null, address: "second@example.com" }
    ])
    expect(message.cc).toEqual([{ name: "Boss", address: "boss@example.com" }])
    expect(message.subject).toBe("Interview invitation")
    expect(message.sentAt).toBe("2026-10-30T10:00:00.000Z")
    expect(message.receivedAt).toBe("2026-10-30T10:05:00.000Z")
    expect(message.size).toBe(rawMessage.length)
    expect(message.text).toContain("Your interview is confirmed.")
    expect(message.text).not.toContain("HTML only copy")
    expect(message.snippet).toBe(message.text.replace(/\s+/g, " ").trim())
    expect(message.snippet.length).toBeLessThanOrEqual(300)
    expect(message.listId).toContain("jobs.acme.example")
    expect(message.authResults).toContain("spf=pass")
    expect(message.attachmentCount).toBe(1)
    expect(message.attachmentNames).toEqual(["cv.pdf"])
  })

  test("falls back to HTML when there is no text/plain part", async () => {
    const html = [
      "From: HR <hr@example.com>",
      "To: Ivan <ivan@example.com>",
      "Subject: HTML only",
      "Message-ID: <html@example.com>",
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="utf-8"',
      "",
      "<p>Hello&nbsp;<b>Ivan</b></p><p>Second line</p>"
    ].join("\r\n")

    const message = await parseFetchedMessage(
      "INBOX",
      { uid: 8, source: Buffer.from(html), size: html.length },
      "me@example.com"
    )

    expect(message?.text).toContain("Hello Ivan")
    expect(message?.text).toContain("Second line")
    expect(message?.text).not.toContain("<p>")
  })

  test("synthesizes a stable id when Message-ID is missing", async () => {
    const bare = [
      "From: hr@example.com",
      "To: ivan@example.com",
      "Subject: no id",
      "MIME-Version: 1.0",
      "Content-Type: text/plain",
      "",
      "body"
    ].join("\r\n")

    const first = await parseFetchedMessage(
      "INBOX",
      { uid: 5, source: Buffer.from(bare) },
      "me@example.com"
    )
    const second = await parseFetchedMessage(
      "INBOX",
      { uid: 5, source: Buffer.from(bare) },
      "me@example.com"
    )

    expect(first?.rfcMessageId).toBe(syntheticMessageId("me@example.com", "INBOX", 5))
    expect(second?.rfcMessageId).toBe(first?.rfcMessageId)
    expect(first?.text).toBe("body")
  })

  test("keeps the Gmail thread id from a header", async () => {
    const gmail = [
      "From: hr@example.com",
      "To: ivan@example.com",
      "Subject: gmail",
      "Message-ID: <gmail@example.com>",
      "X-GM-THRID: 1234567890",
      "MIME-Version: 1.0",
      "Content-Type: text/plain",
      "",
      "body"
    ].join("\r\n")

    const message = await parseFetchedMessage(
      "INBOX",
      { uid: 9, source: Buffer.from(gmail) },
      "me@example.com"
    )
    expect(message?.threadId).toBe("1234567890")
  })

  test("falls back to the envelope when no source was fetched", async () => {
    const message = await parseFetchedMessage(
      "INBOX",
      { uid: 10, envelope: { subject: "Only envelope", from: [{ address: "a@example.com" }] } },
      "me@example.com"
    )

    expect(message?.rfcMessageId).toBe(syntheticMessageId("me@example.com", "INBOX", 10))
    expect(message?.subject).toBe("Only envelope")
    expect(message?.from).toEqual([{ name: null, address: "a@example.com" }])
    expect(message?.text).toBe("")
    expect(message?.snippet).toBe("")
    expect(message?.attachmentCount).toBe(0)
    expect(message?.size).toBe(0)
    expect(message?.threadId).toBeUndefined()
    expect(Number.isNaN(Date.parse(message?.receivedAt ?? ""))).toBe(false)
  })

  test("ignores a malformed UID", async () => {
    expect(await parseFetchedMessage("INBOX", { uid: 0 }, "me@example.com")).toBeNull()
  })
})
