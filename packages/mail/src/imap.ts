import { ImapFlow } from "imapflow"
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser"
import { MailError, isAuthFailure, isMissingMailbox } from "./errors.ts"
import { findFolderByRole, folderRole } from "./folders.ts"
import type { MailGateway } from "./gateway.ts"
import {
  normalizeMessageId,
  normalizeMessageIds,
  plainText,
  snippetOf,
  syntheticMessageId,
  toMailAddresses
} from "./normalize.ts"
import type {
  ImapConfig,
  MailAccountStatus,
  MailFolder,
  MailMessage,
  MailPage,
  MailQuery
} from "./types.ts"

const MAX_SOURCE_BYTES = 512 * 1024
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const DEFAULT_SINCE_DAYS = 90
const DEFAULT_SECURE = true

/** The subset of an IMAP FETCH response that parsing needs, kept structural for tests. */
export interface ImapFetchItem {
  uid: number
  threadId?: string | undefined
  source?: Buffer | undefined
  size?: number | undefined
  internalDate?: Date | string | undefined
  envelope?:
    | {
        date?: Date | string | undefined
        subject?: string | undefined
        messageId?: string | undefined
        inReplyTo?: string | undefined
        from?: Array<{ name?: string | undefined; address?: string | undefined }> | undefined
        to?: Array<{ name?: string | undefined; address?: string | undefined }> | undefined
        cc?: Array<{ name?: string | undefined; address?: string | undefined }> | undefined
      }
    | undefined
}

const headerText = (value: unknown): string | null => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    const parts = value.map(headerText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join(", ") : null
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text
    return typeof text === "string" ? text : null
  }
  return null
}

const headerValue = (parsed: ParsedMail | null, name: string): string | null => {
  const text = headerText(parsed?.headers.get(name))
  return text?.trim() || null
}

/** mailparser exposes List-Id as `list: { id: { name, id } }` rather than a raw header. */
const listIdValue = (parsed: ParsedMail | null): string | null => {
  const direct = headerValue(parsed, "list-id")
  if (direct) return direct
  const list = parsed?.headers.get("list")
  if (!list || typeof list !== "object" || !("id" in list)) return null
  const id = (list as { id?: { name?: unknown; id?: unknown } }).id
  const name = typeof id?.name === "string" ? id.name.trim() : ""
  const value = typeof id?.id === "string" ? id.id.trim() : ""
  if (name && value) return `${name} <${value}>`
  return value || name || null
}

const addressList = (
  value: AddressObject | AddressObject[] | undefined
): Array<{ name?: string | undefined; address?: string | undefined }> | undefined => {
  if (!value) return undefined
  const list = Array.isArray(value) ? value : [value]
  return list.flatMap((item) => item.value ?? [])
}

const toIso = (value: Date | string | undefined): string | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const clampDays = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_SINCE_DAYS
  return Math.min(Math.max(Math.trunc(value as number), 1), 3650)
}

const clampLimit = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(value as number), 1), MAX_LIMIT)
}

/**
 * IMAP transport. Connects lazily, keeps one connection open and never logs
 * credentials or message bodies.
 */
export class ImapGateway implements MailGateway {
  private readonly config: Required<ImapConfig>
  private client: ImapFlow | null = null

  constructor(config: ImapConfig) {
    const secure = config.secure ?? DEFAULT_SECURE
    this.config = {
      host: config.host,
      port: config.port ?? (secure ? 993 : 143),
      secure,
      username: config.username,
      password: config.password
    }
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client) return this.client
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      disableAutoIdle: true
    })
    try {
      await client.connect()
    } catch (error) {
      await client.logout().catch(() => {})
      if (isAuthFailure(error)) {
        throw new MailError(
          "auth",
          `Mail server rejected the credentials for ${this.config.username}`,
          { cause: error }
        )
      }
      throw new MailError(
        "connect",
        `Cannot connect to ${this.config.host}:${this.config.port}`,
        { cause: error }
      )
    }
    this.client = client
    return client
  }

  async verify(): Promise<MailAccountStatus> {
    const client = await this.connect()
    const folders = await client.list()
    let messages: number | null = null
    try {
      const status = await client.status("INBOX", { messages: true })
      messages = status ? (status.messages ?? null) : null
    } catch {
      messages = null
    }
    return { address: this.config.username, folders: folders.length, messages }
  }

  async listFolders(): Promise<MailFolder[]> {
    const client = await this.connect()
    const list = await client.list()
    return list
      .filter((item) => !item.flags.has("\\Noselect"))
      .map((item) => ({
        path: item.path,
        name: item.name,
        role: folderRole(item.path, item.specialUse),
        uidValidity: null
      }))
  }

  /**
   * Resolve INBOX and Sent without assuming both exist. A server that has no
   * Sent folder yields `sent: null` instead of a failed sync.
   */
  async discoverFolders(): Promise<{ inbox: MailFolder | null; sent: MailFolder | null }> {
    const folders = await this.listFolders()
    return {
      inbox: findFolderByRole(folders, "inbox"),
      sent: findFolderByRole(folders, "sent")
    }
  }

  async fetchPage(folder: string, query: MailQuery = {}): Promise<MailPage> {
    const client = await this.connect()
    const afterUid = query.afterUid ?? 0
    const lock = await this.lock(client, folder)
    if (!lock) return { messages: [], lastUid: afterUid, uidValidity: null }
    try {
      const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : null
      const since = new Date(Date.now() - clampDays(query.sinceDays) * 24 * 60 * 60 * 1000)
      const found = await client.search({ since }, { uid: true })
      const uids = (Array.isArray(found) ? found : [])
        .filter((uid) => uid > afterUid)
        .sort((a, b) => a - b)
        .slice(0, clampLimit(query.limit))

      if (uids.length === 0) return { messages: [], lastUid: afterUid, uidValidity }

      const messages: MailMessage[] = []
      for await (const item of client.fetch(
        uids.join(","),
        {
          uid: true,
          threadId: true,
          internalDate: true,
          size: true,
          envelope: true,
          source: { maxLength: MAX_SOURCE_BYTES }
        },
        { uid: true }
      )) {
        const message = await parseFetchedMessage(
          folder,
          item as ImapFetchItem,
          this.config.username
        )
        if (message) messages.push(message)
      }

      return {
        messages,
        lastUid: uids[uids.length - 1] ?? afterUid,
        uidValidity
      }
    } finally {
      lock.release()
    }
  }

  async fetchMessage(folder: string, uid: number): Promise<MailMessage | null> {
    const client = await this.connect()
    const lock = await this.lock(client, folder)
    if (!lock) return null
    try {
      for await (const item of client.fetch(
        String(uid),
        {
          uid: true,
          threadId: true,
          internalDate: true,
          size: true,
          envelope: true,
          source: { maxLength: MAX_SOURCE_BYTES }
        },
        { uid: true }
      )) {
        return await parseFetchedMessage(folder, item as ImapFetchItem, this.config.username)
      }
      return null
    } finally {
      lock.release()
    }
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    if (!client) return
    await client.logout().catch(() => {})
  }

  private async lock(
    client: ImapFlow,
    folder: string
  ): Promise<Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | null> {
    try {
      return await client.getMailboxLock(folder)
    } catch (error) {
      if (isMissingMailbox(error)) return null
      throw new MailError("protocol", `Cannot open mailbox ${folder}`, { cause: error })
    }
  }
}

/** Map one FETCH response to a normalized message. Exported for fixture tests. */
export const parseFetchedMessage = async (
  folder: string,
  item: ImapFetchItem,
  account: string
): Promise<MailMessage | null> => {
  if (!item.uid) return null

  let parsed: ParsedMail | null = null
  if (item.source) {
    try {
      parsed = await simpleParser(item.source)
    } catch {
      parsed = null
    }
  }

  const messageId =
    normalizeMessageId(parsed?.messageId ?? item.envelope?.messageId) ??
    syntheticMessageId(account, folder, item.uid)
  const references = normalizeMessageIds(parsed?.references)
  const text = plainText({ text: parsed?.text, html: parsed?.html })
  const receivedAt =
    toIso(item.internalDate) ??
    toIso(parsed?.date) ??
    toIso(item.envelope?.date) ??
    new Date().toISOString()
  const sentAt = toIso(parsed?.date) ?? toIso(item.envelope?.date)
  const attachments = parsed?.attachments ?? []
  const threadId = item.threadId ?? headerValue(parsed, "x-gm-thrid") ?? undefined

  return {
    folder,
    uid: item.uid,
    rfcMessageId: messageId,
    ...(threadId ? { threadId } : {}),
    inReplyTo: normalizeMessageId(parsed?.inReplyTo ?? item.envelope?.inReplyTo),
    references,
    from: toMailAddresses(addressList(parsed?.from) ?? item.envelope?.from),
    to: toMailAddresses(addressList(parsed?.to) ?? item.envelope?.to),
    cc: toMailAddresses(addressList(parsed?.cc) ?? item.envelope?.cc),
    subject: parsed?.subject?.trim() || item.envelope?.subject?.trim() || null,
    sentAt,
    receivedAt,
    text,
    snippet: snippetOf(text),
    listId: listIdValue(parsed),
    authResults: headerValue(parsed, "authentication-results"),
    attachmentCount: attachments.length,
    attachmentNames: attachments
      .map((attachment) => attachment.filename ?? "")
      .filter((name) => name.length > 0),
    size: item.size ?? item.source?.length ?? 0
  }
}
