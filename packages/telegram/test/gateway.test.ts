import { describe, expect, test } from "bun:test"
import { FakeTelegramGateway } from "../src/fake.ts"
import { qrLoginUrl } from "../src/gateway.ts"
import { messageRead, messageReadUpTo } from "../src/messages.ts"
import type { TelegramDialog, TelegramMessage, TelegramUser } from "../src/types.ts"

const user: TelegramUser = {
  id: "42",
  username: "operator",
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+79991234567"
}

const dialog: TelegramDialog = {
  id: "777",
  title: "Acme HR",
  username: "acme_hr",
  kind: "private",
  lastMessageAt: "2026-11-01T10:00:00.000Z",
  lastMessage: "Hello",
  unreadCount: 2,
  readInboxMaxId: 10,
  readOutboxMaxId: 5,
  archived: false
}

const history: TelegramMessage[] = [
  {
    id: "7",
    direction: "in",
    sentAt: "2026-11-01T09:00:00.000Z",
    editedAt: null,
    kind: "text",
    text: "Hi",
    replyToId: null
  },
  {
    id: "8",
    direction: "out",
    sentAt: "2026-11-01T09:01:00.000Z",
    editedAt: "2026-11-01T09:02:00.000Z",
    kind: "media",
    text: null,
    replyToId: "7"
  }
]

describe("qrLoginUrl", () => {
  test("builds the Telegram deep link from the token", () => {
    expect(qrLoginUrl(Uint8Array.of(1, 2, 3))).toBe("tg://login?token=AQID")
  })

  test("uses base64url so the link stays query-safe", () => {
    const url = qrLoginUrl(Uint8Array.of(0xfb, 0xff))
    expect(url).toBe("tg://login?token=-_8")
    expect(url.slice("tg://login?token=".length)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("message read watermark", () => {
  test("covers ids up to the watermark", () => {
    expect(messageReadUpTo("10", 10)).toBe(true)
    expect(messageReadUpTo("10", 9)).toBe(false)
    expect(messageReadUpTo("11", 10)).toBe(false)
  })

  test("treats unknown and non-numeric ids as unread", () => {
    expect(messageReadUpTo("10", null)).toBe(false)
    expect(messageReadUpTo("10", undefined)).toBe(false)
    expect(messageReadUpTo("not-an-id", 10)).toBe(false)
    expect(messageReadUpTo("0", 10)).toBe(false)
    expect(messageReadUpTo("-3", 10)).toBe(false)
  })

  test("picks the watermark by direction", () => {
    expect(messageRead({ id: "10", direction: "in" }, dialog)).toBe(true)
    expect(messageRead({ id: "11", direction: "in" }, dialog)).toBe(false)
    expect(messageRead({ id: "5", direction: "out" }, dialog)).toBe(true)
    expect(messageRead({ id: "6", direction: "out" }, dialog)).toBe(false)
  })
})

describe("FakeTelegramGateway", () => {
  test("phone login asks for the phone and the code", async () => {
    const gateway = new FakeTelegramGateway({ me: user })
    await gateway.connect()
    expect(gateway.connected).toBe(true)

    const asked: string[] = []
    const me = await gateway.login({
      phone: async () => {
        asked.push("phone")
        return user.phone!
      },
      code: async (sentViaApp) => {
        asked.push(sentViaApp ? "code:app" : "code:sms")
        return "12345"
      },
      onError: () => {}
    })

    expect(asked).toEqual(["phone", "code:sms"])
    expect(me).toEqual(user)
    expect(gateway.logins).toEqual(["phone"])
  })

  test("qr login hands the link to the callback and returns the profile", async () => {
    const expiresAt = new Date("2026-11-02T12:00:00.000Z")
    const gateway = new FakeTelegramGateway({
      me: user,
      qrUrl: "tg://login?token=ZmFrZQ",
      qrExpiresAt: expiresAt
    })

    const shown: Array<{ url: string; expiresAt: Date }> = []
    const me = await gateway.loginWithQr({
      onQr: (url, expires) => shown.push({ url, expiresAt: expires }),
      onError: () => {}
    })

    expect(shown).toEqual([{ url: "tg://login?token=ZmFrZQ", expiresAt }])
    expect(me).toEqual(user)
    expect(gateway.logins).toEqual(["qr"])
  })

  test("lists dialogs and the last messages of a chat", async () => {
    const gateway = new FakeTelegramGateway({
      me: user,
      dialogs: [dialog],
      messages: { "777": history }
    })
    await gateway.loginWithQr({ onQr: () => {}, onError: () => {} })

    expect(await gateway.listDialogs()).toEqual([dialog])
    expect(await gateway.listMessages("777")).toEqual(history)
    expect(await gateway.listMessages("777", 1)).toEqual([history[1]!])
    expect(await gateway.listMessages("missing")).toEqual([])
  })

  test("sending appends an outgoing message with the next id", async () => {
    const gateway = new FakeTelegramGateway({
      me: user,
      dialogs: [dialog],
      messages: { "777": history },
      now: () => new Date("2026-11-02T08:00:00.000Z")
    })
    await gateway.loginWithQr({ onQr: () => {}, onError: () => {} })

    const sent = await gateway.sendMessage("777", "Thanks")

    expect(sent).toEqual({
      id: "9",
      direction: "out",
      sentAt: "2026-11-02T08:00:00.000Z",
      editedAt: null,
      kind: "text",
      text: "Thanks",
      replyToId: null
    })
    expect(await gateway.listMessages("777")).toEqual([...history, sent])
    expect(gateway.sent).toEqual([{ chatId: "777", text: "Thanks", message: sent }])
    expect(gateway.dialogs[0]!.lastMessage).toBe("Thanks")
    expect(gateway.dialogs[0]!.lastMessageAt).toBe("2026-11-02T08:00:00.000Z")
  })

  test("me needs a session, logout clears it", async () => {
    const gateway = new FakeTelegramGateway({ me: user, session: "fake-session" })
    await expect(gateway.me()).rejects.toThrow(/not signed in/)

    await gateway.loginWithQr({ onQr: () => {}, onError: () => {} })
    expect(gateway.sessionString()).toBe("fake-session")

    await gateway.logout()
    expect(gateway.sessionString()).toBe("")
    expect(gateway.connected).toBe(false)
    await expect(gateway.me()).rejects.toThrow(/not signed in/)
  })
})
