/**
 * Plain data that crosses the module boundary. Teleproto types never escape
 * `gateway.ts`, so callers (and the cloud) depend on this file only.
 */

export interface TelegramUser {
  id: string
  username: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
}

export type TelegramDialogKind = "private" | "group" | "channel" | "unknown"

export interface TelegramDialog {
  id: string
  title: string | null
  username: string | null
  kind: TelegramDialogKind
  lastMessageAt: string | null
  lastMessage: string | null
  unreadCount: number
  /** Highest incoming message id this account has read. */
  readInboxMaxId: number | null
  /** Highest outgoing message id the other side has read. */
  readOutboxMaxId: number | null
  archived: boolean
}

export type TelegramMessageDirection = "in" | "out"
export type TelegramMessageKind = "text" | "media" | "service"

export interface TelegramMessage {
  id: string
  direction: TelegramMessageDirection
  sentAt: string
  editedAt: string | null
  kind: TelegramMessageKind
  text: string | null
  replyToId: string | null
}

export interface LoginCallbacks {
  /** Phone number in international format, including the leading `+`. */
  phone: () => Promise<string>
  /** Login code; `sentViaApp` tells the operator where to look for it. */
  code: (sentViaApp?: boolean) => Promise<string>
  /** Two-factor password, asked only when Telegram requires it. */
  password?: (hint?: string) => Promise<string>
  onError: (error: Error) => void
}

export interface QrLoginCallbacks {
  /** Called with every refreshed `tg://login?token=…` link and its expiry. */
  onQr: (url: string, expiresAt: Date) => void
  password?: (hint?: string) => Promise<string>
  onError: (error: Error) => void
}

/**
 * The small surface the rest of the app depends on. `TeleprotoGateway` is the
 * real implementation and `FakeTelegramGateway` is the test double; neither
 * leaks transport details.
 */
export interface TelegramGateway {
  connect(): Promise<void>
  login(callbacks: LoginCallbacks): Promise<TelegramUser>
  loginWithQr(callbacks: QrLoginCallbacks): Promise<TelegramUser>
  me(): Promise<TelegramUser>
  listDialogs(limit?: number): Promise<TelegramDialog[]>
  /**
   * Последние сообщения диалога по возрастанию id. С `minId` возвращаются только
   * сообщения с id строго больше `minId` (инкрементальная синхронизация).
   */
  listMessages(chatId: string, limit?: number, minId?: number): Promise<TelegramMessage[]>
  sendMessage(chatId: string, text: string): Promise<TelegramMessage>
  /** Serialized session. Never log this value. */
  sessionString(): string
  disconnect(): Promise<void>
  logout(): Promise<void>
}
