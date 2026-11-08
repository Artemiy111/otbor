/**
 * The teleproto implementation of `TelegramGateway`.
 *
 * One instance owns one MTProto connection. The session string is a secret:
 * it is returned to the caller for `storage.writeSession` and is never logged
 * here, and neither is the QR login token.
 */

import { TelegramClient, type Api } from "teleproto"
import { SocksTransport } from "teleproto/network"
import { StringSession } from "teleproto/sessions"
import type { TelegramProxy } from "./storage.ts"
import type {
  LoginCallbacks,
  QrLoginCallbacks,
  TelegramDialog,
  TelegramGateway,
  TelegramMessage,
  TelegramUser
} from "./types.ts"

export interface TeleprotoGatewayOptions {
  apiId: number
  apiHash: string
  /** Serialized session from a previous login; empty for a fresh login. */
  session?: string
  proxy?: TelegramProxy | null
}

/** The QR payload is a `tg://login?token=…` deep link, not an OAuth redirect. */
export const qrLoginUrl = (token: Uint8Array): string =>
  `tg://login?token=${Buffer.from(token).toString("base64url")}`

const toTransport = (proxy: TelegramProxy): SocksTransport =>
  new SocksTransport({
    host: proxy.host,
    port: proxy.port,
    version: proxy.kind === "socks4" ? 4 : 5,
    ...(proxy.username ? { username: proxy.username } : {}),
    ...(proxy.password ? { password: proxy.password } : {}),
    timeout: 15
  })

const toUser = (user: Api.User): TelegramUser => ({
  id: String(user.id),
  username: user.username ?? null,
  firstName: user.firstName ?? null,
  lastName: user.lastName ?? null,
  phone: user.phone ?? null
})

const toMessage = (message: Api.Message): TelegramMessage => {
  const replyToId = message.replyTo?.replyToMsgId
  return {
    id: String(message.id),
    direction: message.out ? "out" : "in",
    sentAt: new Date(message.date * 1000).toISOString(),
    editedAt: message.editDate
      ? new Date(message.editDate * 1000).toISOString()
      : null,
    kind: message.action ? "service" : message.media ? "media" : "text",
    text: message.message ?? null,
    replyToId: replyToId === undefined ? null : String(replyToId)
  }
}

/** Dialog ids arrive as decimal strings and are accepted back as peers. */
const toPeer = (chatId: string): string | number =>
  /^-?\d+$/.test(chatId) ? Number(chatId) : chatId

/**
 * One MTProto connection. Callers persist `sessionString()` through
 * `storage.writeSession`; nothing here touches disk.
 */
export class TeleprotoGateway implements TelegramGateway {
  private readonly client: TelegramClient
  private readonly credentials: { apiId: number; apiHash: string }

  constructor(options: TeleprotoGatewayOptions) {
    this.credentials = { apiId: options.apiId, apiHash: options.apiHash }
    this.client = new TelegramClient(
      new StringSession(options.session ?? ""),
      options.apiId,
      options.apiHash,
      {
        connectionRetries: 1,
        requestRetries: 1,
        timeout: 20,
        autoReconnect: false,
        ...(options.proxy ? { transport: toTransport(options.proxy) } : {})
      }
    )
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  /** Phone + code + optional 2FA. No-op when the session is already signed in. */
  async login(callbacks: LoginCallbacks): Promise<TelegramUser> {
    await this.client.start({
      phoneNumber: callbacks.phone,
      phoneCode: callbacks.code,
      ...(callbacks.password ? { password: callbacks.password } : {}),
      onError: async (error) => {
        callbacks.onError(error)
        return false
      }
    })
    return this.me()
  }

  /**
   * Telegram's "Link Desktop Device" flow: show the returned `tg://` link,
   * confirm on the phone, and the session is authorized. The token is a
   * credential; it must not be logged.
   */
  async loginWithQr(callbacks: QrLoginCallbacks): Promise<TelegramUser> {
    await this.client.signInUserWithQrCode(this.credentials, {
      qrCode: async ({ token, expires }) => {
        callbacks.onQr(qrLoginUrl(token), new Date(expires * 1000))
      },
      ...(callbacks.password ? { password: callbacks.password } : {}),
      onError: async (error) => {
        callbacks.onError(error)
        return false
      }
    })
    return this.me()
  }

  async me(): Promise<TelegramUser> {
    return toUser(await this.client.getMe())
  }

  async listDialogs(limit = 20): Promise<TelegramDialog[]> {
    const dialogs = await this.client.getDialogs({ limit })
    return dialogs.map((dialog) => {
      const entity = dialog.entity as { username?: string } | undefined
      return {
        id: dialog.id === undefined ? "" : dialog.id.toString(),
        title: dialog.title ?? dialog.name ?? null,
        username: entity?.username ?? null,
        kind: dialog.isUser
          ? "private"
          : dialog.isGroup
            ? "group"
            : dialog.isChannel
              ? "channel"
              : "unknown",
        lastMessageAt: dialog.date
          ? new Date(dialog.date * 1000).toISOString()
          : null,
        lastMessage: dialog.message?.message ?? null,
        unreadCount: dialog.unreadCount ?? 0,
        readInboxMaxId:
          typeof dialog.dialog.readInboxMaxId === "number"
            ? dialog.dialog.readInboxMaxId
            : null,
        readOutboxMaxId:
          typeof dialog.dialog.readOutboxMaxId === "number"
            ? dialog.dialog.readOutboxMaxId
            : null,
        archived: dialog.archived ?? false
      }
    })
  }

  /**
   * Last messages of a dialog in chronological order. Call `listDialogs`
   * first on the same connection so teleproto has the entity cached.
   */
  async listMessages(chatId: string, limit = 50, minId?: number): Promise<TelegramMessage[]> {
    const messages = await this.client.getMessages(toPeer(chatId), {
      limit,
      ...(minId === undefined ? {} : { minId })
    })
    return messages
      .filter((message) => minId === undefined || message.id > minId)
      .map(toMessage)
      .sort((left, right) => Number(left.id) - Number(right.id))
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramMessage> {
    const sent = await this.client.sendMessage(toPeer(chatId), { message: text })
    return toMessage(sent)
  }

  sessionString(): string {
    return String(this.client.session.save())
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  /** Invalidates the session on Telegram's side, then disconnects. */
  async logout(): Promise<void> {
    await this.client.logOut()
  }
}
