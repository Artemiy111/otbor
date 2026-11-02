import type { MailGateway } from "./gateway.ts"
import type { MailAccountStatus, MailFolder, MailMessage, MailPage, MailQuery } from "./types.ts"

export interface FakeMailInput {
  address?: string
  folders?: MailFolder[]
  messages?: MailMessage[]
  uidValidity?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** In-memory gateway: deterministic paging, no network, no IMAP. */
export class FakeMailGateway implements MailGateway {
  private readonly address: string
  private readonly folders: MailFolder[]
  private readonly messages: MailMessage[]
  private readonly uidValidity: string

  constructor(input: FakeMailInput = {}) {
    this.address = input.address ?? "me@example.com"
    this.uidValidity = input.uidValidity ?? "1"
    this.folders = input.folders ?? [
      { path: "INBOX", name: "Inbox", role: "inbox", uidValidity: this.uidValidity },
      { path: "Sent", name: "Sent", role: "sent", uidValidity: this.uidValidity }
    ]
    this.messages = input.messages ?? []
  }

  async verify(): Promise<MailAccountStatus> {
    return {
      address: this.address,
      folders: this.folders.length,
      messages: this.messages.filter((message) => message.folder === "INBOX").length
    }
  }

  async listFolders(): Promise<MailFolder[]> {
    return [...this.folders]
  }

  async fetchPage(folder: string, query: MailQuery = {}): Promise<MailPage> {
    const afterUid = query.afterUid ?? 0
    const limit = Math.max(Math.trunc(query.limit ?? 100), 1)
    const cutoff = query.sinceDays === undefined ? null : Date.now() - query.sinceDays * DAY_MS
    const page = this.messages
      .filter((message) => message.folder === folder && message.uid > afterUid)
      .filter((message) => cutoff === null || Date.parse(message.receivedAt) >= cutoff)
      .sort((a, b) => a.uid - b.uid)
      .slice(0, limit)
    return {
      messages: page,
      lastUid: page[page.length - 1]?.uid ?? afterUid,
      uidValidity: this.uidValidity
    }
  }

  async fetchMessage(folder: string, uid: number): Promise<MailMessage | null> {
    return (
      this.messages.find((message) => message.folder === folder && message.uid === uid) ?? null
    )
  }

  async close(): Promise<void> {}
}
