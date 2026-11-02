export type MailErrorCode =
  | "auth"
  | "connect"
  | "folder_not_found"
  | "protocol"
  | "invalid_account_id"
  | "bad_secret"

/** Transport/storage failure with a stable code for callers. */
export class MailError extends Error {
  readonly code: MailErrorCode

  constructor(code: MailErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "MailError"
    this.code = code
  }
}

/**
 * IMAP servers report failed logins as plain text. Keep the check narrow so a
 * network failure is not reported as a wrong password.
 */
export const isAuthFailure = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error)
  return /auth|login|credentials|password|application-specific/i.test(text)
}

/** Missing mailbox errors differ between servers; these are the common forms. */
export const isMissingMailbox = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error)
  return /nonexistent|does not exist|no such mailbox|not found|non-existent/i.test(text)
}
