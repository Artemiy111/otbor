/** Normalized e-mail address with an optional display name. */
export interface MailAddress {
  name: string | null
  address: string
}

export type MailFolderRole = "inbox" | "sent" | "archive" | "spam" | "trash" | "other"

export interface MailFolder {
  path: string
  name: string
  role: MailFolderRole
  uidValidity: string | null
}

export interface MailQuery {
  /** How far back to look on the first sync. Defaults to 90 days. */
  sinceDays?: number
  /** Return only messages with a bigger UID. */
  afterUid?: number
  /** Page size, capped at 500. Defaults to 100. */
  limit?: number
}

export interface MailMessage {
  folder: string
  uid: number
  /** RFC Message-ID without angle brackets; synthetic when the header is absent. */
  rfcMessageId: string
  /** Gmail X-GM-THRID or OBJECTID thread id when the server supports it. */
  threadId?: string
  inReplyTo: string | null
  references: string[]
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string | null
  sentAt: string | null
  receivedAt: string
  text: string
  snippet: string
  listId: string | null
  authResults: string | null
  attachmentCount: number
  attachmentNames: string[]
  size: number
}

export interface MailPage {
  messages: MailMessage[]
  /** Highest UID in this page, or the previous cursor when nothing came back. */
  lastUid: number
  uidValidity: string | null
}

export interface MailAccountStatus {
  address: string
  folders: number
  messages: number | null
}

/** Connection settings used by {@link ImapGateway}. */
export interface ImapConfig {
  host: string
  /** Defaults to 993 when `secure` is true and 143 otherwise. */
  port?: number
  /** TLS is on by default. */
  secure?: boolean
  username: string
  password: string
}
