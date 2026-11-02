import type { MailFolder, MailFolderRole } from "./types.ts"

const SENT_NAMES = new Set([
  "sent",
  "sent mail",
  "sent items",
  "sent messages",
  "отправленные",
  "отправлено"
])
const ARCHIVE_NAMES = new Set(["archive", "archives", "архив"])
const SPAM_NAMES = new Set(["spam", "junk", "junk e-mail", "junk email", "спам"])
const TRASH_NAMES = new Set(["trash", "deleted items", "deleted messages", "корзина"])

const lastSegment = (path: string): string => path.split("/").at(-1)?.trim().toLowerCase() ?? ""

/**
 * Map a server folder to a role. Special-use flags win; name matching is only
 * a fallback for servers that do not advertise SPECIAL-USE.
 */
export const folderRole = (path: string, specialUse?: string | null): MailFolderRole => {
  const special = specialUse?.trim().toLowerCase() ?? ""
  if (special.includes("\\inbox")) return "inbox"
  if (special.includes("\\sent")) return "sent"
  if (special.includes("\\archive")) return "archive"
  if (special.includes("\\junk") || special.includes("\\spam")) return "spam"
  if (special.includes("\\trash")) return "trash"

  if (path.trim().toUpperCase() === "INBOX") return "inbox"
  const name = lastSegment(path)
  if (SENT_NAMES.has(name)) return "sent"
  if (ARCHIVE_NAMES.has(name)) return "archive"
  if (SPAM_NAMES.has(name)) return "spam"
  if (TRASH_NAMES.has(name)) return "trash"
  return "other"
}

/**
 * Find a role without assuming every account has it. Returns null when the
 * server has no such folder, so callers can skip the role instead of failing.
 */
export const findFolderByRole = (
  folders: readonly MailFolder[],
  role: MailFolderRole
): MailFolder | null => folders.find((folder) => folder.role === role) ?? null
