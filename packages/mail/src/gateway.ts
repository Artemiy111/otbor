import type { MailAccountStatus, MailFolder, MailMessage, MailPage, MailQuery } from "./types.ts"

/**
 * Transport-agnostic mailbox port. `ImapGateway` is the IMAP implementation;
 * a different provider can be added without touching callers.
 */
export interface MailGateway {
  verify(): Promise<MailAccountStatus>
  listFolders(): Promise<MailFolder[]>
  fetchPage(folder: string, query?: MailQuery): Promise<MailPage>
  fetchMessage(folder: string, uid: number): Promise<MailMessage | null>
  close(): Promise<void>
}
