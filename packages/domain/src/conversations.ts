/**
 * Thread keys for the channel-agnostic conversation model.
 *
 * A mail thread is identified by the server's thread id (Gmail), otherwise the
 * root of the References chain, otherwise In-Reply-To, otherwise the subject
 * with reply prefixes stripped. Nothing here guesses: an empty input yields an
 * empty key rather than a synthetic subject.
 */

const REPLY_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|ответ|пересл)\s*(?:\[\d+\])?\s*:\s*)+/iu

/** `Re: [EXTERNAL] Re: Senior DevOps` -> `senior devops`. */
export const normalizeSubject = (subject: string | null | undefined): string => {
  const base = (subject ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(REPLY_PREFIX, "")
    .trim()
  return base.toLowerCase()
}

const stripBrackets = (value: string): string => value.trim().replace(/^<+/, "").replace(/>+$/, "")

export interface MailThreadInput {
  /** Gmail X-GM-THRID or another stable server thread id. */
  readonly threadId?: string | null
  readonly rfcMessageId?: string | null
  readonly inReplyTo?: string | null
  readonly references?: ReadonlyArray<string>
  readonly subject?: string | null
}

/**
 * Stable external id for a mail conversation. Prefixed by scheme so a Gmail id
 * and an RFC Message-ID can never collide.
 *
 * The original message of a thread gets `subj:<subject>`. A reply with a known
 * parent resolves to that parent's conversation through the mail service; the
 * `rfc:<root>` key is only used when the parent is not stored and the subject
 * is empty, so a reply that arrives first does not split the thread.
 */
export const mailThreadKey = (input: MailThreadInput): string => {
  const threadId = input.threadId?.trim()
  if (threadId !== undefined && threadId !== "") return `gm:${threadId}`

  const root = (input.references ?? [])
    .map(stripBrackets)
    .find((reference) => reference !== "")
  if (root !== undefined) return `rfc:${root}`

  const parent = input.inReplyTo?.trim()
  if (parent !== undefined && parent !== "") return `rfc:${stripBrackets(parent)}`

  const subject = normalizeSubject(input.subject)
  if (subject !== "") return `subj:${subject}`

  const own = input.rfcMessageId?.trim()
  if (own !== undefined && own !== "") return `rfc:${stripBrackets(own)}`

  return "subj:"
}

/** hh chat threads use the hh thread id; there is no mail header here. */
export const hhChatThreadKey = (threadId: string): string => `hh:${threadId.trim()}`

/** Telegram dialogs are already a thread: the chat id is the key. */
export const telegramThreadKey = (chatId: string): string => `tg:${chatId.trim()}`
