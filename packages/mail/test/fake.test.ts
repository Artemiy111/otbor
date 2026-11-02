import { describe, expect, test } from "bun:test"
import { FakeMailGateway, type MailFolder, type MailMessage } from "../src/index.ts"

const message = (uid: number, folder = "INBOX", daysAgo = 0): MailMessage => ({
  folder,
  uid,
  rfcMessageId: `m${uid}@example.com`,
  threadId: undefined,
  inReplyTo: null,
  references: [],
  from: [{ name: "HR", address: "hr@example.com" }],
  to: [{ name: null, address: "me@example.com" }],
  cc: [],
  subject: `Message ${uid}`,
  sentAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  receivedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  text: `Body ${uid}`,
  snippet: `Body ${uid}`,
  listId: null,
  authResults: null,
  attachmentCount: 0,
  attachmentNames: [],
  size: 10
})

const folders: MailFolder[] = [
  { path: "INBOX", name: "Inbox", role: "inbox", uidValidity: "7" },
  { path: "Sent", name: "Sent", role: "sent", uidValidity: "7" }
]

describe("FakeMailGateway", () => {
  test("pages by uid without skipping or repeating", async () => {
    const gateway = new FakeMailGateway({
      messages: [message(4), message(1), message(5), message(2), message(3)]
    })

    const first = await gateway.fetchPage("INBOX", { limit: 2 })
    expect(first.messages.map((m) => m.uid)).toEqual([1, 2])
    expect(first.lastUid).toBe(2)
    expect(first.uidValidity).toBe("1")

    const second = await gateway.fetchPage("INBOX", { afterUid: first.lastUid, limit: 2 })
    expect(second.messages.map((m) => m.uid)).toEqual([3, 4])
    expect(second.lastUid).toBe(4)

    const third = await gateway.fetchPage("INBOX", { afterUid: second.lastUid, limit: 2 })
    expect(third.messages.map((m) => m.uid)).toEqual([5])
    expect(third.lastUid).toBe(5)

    const done = await gateway.fetchPage("INBOX", { afterUid: third.lastUid, limit: 2 })
    expect(done.messages).toEqual([])
    expect(done.lastUid).toBe(5)
  })

  test("scopes messages to their folder", async () => {
    const gateway = new FakeMailGateway({
      folders,
      messages: [message(1), message(2, "Sent")]
    })

    expect((await gateway.fetchPage("INBOX")).messages.map((m) => m.uid)).toEqual([1])
    expect((await gateway.fetchPage("Sent")).messages.map((m) => m.uid)).toEqual([2])
    expect(await gateway.fetchMessage("INBOX", 2)).toBeNull()
    expect((await gateway.fetchMessage("Sent", 2))?.uid).toBe(2)
  })

  test("filters by sinceDays and reports account status", async () => {
    const gateway = new FakeMailGateway({
      folders,
      uidValidity: "7",
      messages: [message(1, "INBOX", 0), message(2, "INBOX", 30)]
    })

    expect((await gateway.fetchPage("INBOX", { sinceDays: 7 })).messages.map((m) => m.uid)).toEqual([
      1
    ])
    expect((await gateway.fetchPage("INBOX", { sinceDays: 60 })).messages.map((m) => m.uid)).toEqual([
      1, 2
    ])
    expect(await gateway.listFolders()).toEqual(folders)
    expect(await gateway.verify()).toEqual({ address: "me@example.com", folders: 2, messages: 2 })
    await gateway.close()
  })
})
