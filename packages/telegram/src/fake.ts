/**
 * In-memory `TelegramGateway` for tests: no network, no MTProto, no disk.
 * It behaves like the real thing only as far as the port allows.
 */

import type {
  LoginCallbacks,
  QrLoginCallbacks,
  TelegramDialog,
  TelegramGateway,
  TelegramMessage,
  TelegramUser
} from "./types.ts"

export interface FakeTelegramOptions {
  me?: TelegramUser
  dialogs?: TelegramDialog[]
  /** Chat id (the `TelegramDialog.id` value) to its messages, oldest first. */
  messages?: Record<string, TelegramMessage[]>
  session?: string
  qrUrl?: string
  qrExpiresAt?: Date
  now?: () => Date
}

export interface FakeSentMessage {
  chatId: string
  text: string
  message: TelegramMessage
}

const DEFAULT_USER: TelegramUser = {
  id: "1",
  username: "fake",
  firstName: "Fake",
  lastName: null,
  phone: "+70000000000"
}

export class FakeTelegramGateway implements TelegramGateway {
  readonly user: TelegramUser
  readonly dialogs: TelegramDialog[]
  readonly chatMessages: Map<string, TelegramMessage[]>
  readonly sent: FakeSentMessage[] = []
  readonly qrUrl: string
  readonly qrExpiresAt: Date

  connected = false
  authorized = false
  session: string
  readonly logins: Array<"phone" | "qr"> = []

  private readonly now: () => Date

  constructor(options: FakeTelegramOptions = {}) {
    this.user = options.me ?? DEFAULT_USER
    this.dialogs = [...(options.dialogs ?? [])]
    this.chatMessages = new Map(
      Object.entries(options.messages ?? {}).map(([chatId, messages]) => [
        chatId,
        [...messages]
      ])
    )
    this.session = options.session ?? "fake-session"
    this.qrUrl = options.qrUrl ?? "tg://login?token=ZmFrZQ"
    this.qrExpiresAt = options.qrExpiresAt ?? new Date(0)
    this.now = options.now ?? (() => new Date())
  }

  async connect(): Promise<void> {
    this.connected = true
  }

  async login(callbacks: LoginCallbacks): Promise<TelegramUser> {
    this.logins.push("phone")
    await callbacks.phone()
    await callbacks.code(false)
    this.authorized = true
    return this.user
  }

  async loginWithQr(callbacks: QrLoginCallbacks): Promise<TelegramUser> {
    this.logins.push("qr")
    callbacks.onQr(this.qrUrl, this.qrExpiresAt)
    this.authorized = true
    return this.user
  }

  async me(): Promise<TelegramUser> {
    this.assertAuthorized()
    return this.user
  }

  async listDialogs(limit = 20): Promise<TelegramDialog[]> {
    this.assertAuthorized()
    return limit >= 0 ? this.dialogs.slice(0, limit) : [...this.dialogs]
  }

  async listMessages(chatId: string, limit = 50): Promise<TelegramMessage[]> {
    this.assertAuthorized()
    const messages = this.chatMessages.get(chatId) ?? []
    return limit >= 0 ? messages.slice(-limit) : [...messages]
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramMessage> {
    this.assertAuthorized()
    const messages = this.chatMessages.get(chatId) ?? []
    const sentAt = this.now().toISOString()
    const message: TelegramMessage = {
      id: nextId(messages),
      direction: "out",
      sentAt,
      editedAt: null,
      kind: "text",
      text,
      replyToId: null
    }
    messages.push(message)
    this.chatMessages.set(chatId, messages)
    this.sent.push({ chatId, text, message })
    this.touchDialog(chatId, text, sentAt)
    return message
  }

  sessionString(): string {
    return this.session
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async logout(): Promise<void> {
    this.connected = false
    this.authorized = false
    this.session = ""
  }

  private assertAuthorized(): void {
    if (!this.authorized) {
      throw new Error("FakeTelegramGateway: not signed in")
    }
  }

  private touchDialog(chatId: string, text: string, sentAt: string): void {
    const dialog = this.dialogs.find((entry) => entry.id === chatId)
    if (!dialog) return
    dialog.lastMessage = text
    dialog.lastMessageAt = sentAt
  }
}

const nextId = (messages: readonly TelegramMessage[]): string => {
  const ids = messages
    .values()
    .map((message) => Number(message.id))
    .filter((id) => Number.isFinite(id))
    .toArray()
  return String(Math.max(0, ...ids) + 1)
}
