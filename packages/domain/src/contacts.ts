/**
 * Contacts found in free text: e-mail, phones, Telegram handles and links, and
 * hh chat/vacancy references.
 *
 * Pure and synchronous. The same function runs over a vacancy description, a
 * mail body and a Telegram dialog; it never guesses a value that is not in the
 * text, and it never invents a country code for a bare local number.
 */

export type ContactKind = "email" | "telegram" | "phone" | "hh_chat" | "other"

export interface ContactCandidate {
  readonly kind: ContactKind
  /** Normalized value: lowercase e-mail, `+7…` phone, `@username`, or a URL. */
  readonly value: string
  /** The fragment exactly as written in the source text. */
  readonly raw: string
  /** Action URL (`mailto:`, `tel:`, `https://t.me/…`), when there is one. */
  readonly url: string | null
  /** The line the contact was found on. */
  readonly evidence: string
  /** 0..1 */
  readonly confidence: number
  readonly personName: string | null
  readonly personRole: string | null
  /** Telegram reserves the `bot` suffix for bots; a person cannot own one. */
  readonly isBot: boolean
}

export interface ContactExtraction {
  readonly contacts: ReadonlyArray<ContactCandidate>
  /** hh vacancy external ids found in links or `hh:123`-style references. */
  readonly vacancyIds: ReadonlyArray<string>
}

export interface ContactContext {
  /** Sender name from the chat UI or mail headers. */
  readonly senderName?: string | null
  readonly senderRole?: string | null
  /** In a Telegram dialog a bare `@handle` is a contact, not a mention. */
  readonly channel?: "hh" | "telegram" | "mail"
}

const EMAIL =
  /(?<![\p{L}\p{N}_.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?![\p{L}\p{N}])/gu

/** Extensions that look like a TLD but are part of a filename (`logo@2x.png`). */
const FILE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "css",
  "js",
  "mjs",
  "json",
  "html"
])

const PHONE_CANDIDATE =
  /(?<![\p{L}\p{N}_])\+?\d[\d\s\u00A0().\u2013\u2014-]{7,18}\d(?![\p{L}\p{N}])/gu

const TELEGRAM_USERNAME_URL =
  /(?<![\w@])(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog|tg\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?![A-Za-z0-9_])/giu

const TELEGRAM_RESOLVE = /tg:\/\/resolve\?domain=([A-Za-z][A-Za-z0-9_]{3,31})/giu

const TELEGRAM_INVITE =
  /(?<![\w@])(?:https?:\/\/)?(?:www\.)?t\.me\/(?:\+|joinchat\/)([A-Za-z0-9_-]{6,})(?![A-Za-z0-9_-])/giu

const TELEGRAM_HANDLE = /(?<![\p{L}\p{N}_.%+@-])@([A-Za-z][A-Za-z0-9_]{3,31})\b/gu

/** hh chat links; the hh chat itself is not scraped without the browser harness. */
const HH_CHAT_LINK =
  /(?<![\w/])(?:https?:\/\/)?(?:www\.)?(?:hh\.ru|headhunter\.ru|chat\.hh\.ru)\/(?:chat|applicant\/negotiations)\/?([A-Za-z0-9_?=&%./-]*)/giu

const HH_VACANCY_URL =
  /(?<![\w/])(?:https?:\/\/)?(?:www\.)?(?:hh\.ru|headhunter\.ru)\/(?:vacancy|vacancies)\/(\d+)/giu

const HH_VACANCY_ID = /(?<![\w])(?:hh:|vacancy\s*[:#№]?\s*)(\d{5,})(?![\w])/giu

const RESERVED_USERNAMES = new Set([
  "share",
  "joinchat",
  "addstickers",
  "addemoji",
  "setlanguage",
  "login",
  "proxy",
  "socks",
  "contact",
  "iv",
  "telegram",
  "durov"
])

const ROLE_ALTERNATION =
  "тимлид|team\\s?lead|tech\\s?lead|teamlead|рекрутер|recruiter|hr|менеджер по персоналу|руководитель|cto|ceo|основатель|founder"
const ROLE_PATTERN = new RegExp(`(?:${ROLE_ALTERNATION})(?![а-яёa-z])`, "iu")
const NAME_BEFORE_ROLE = new RegExp(
  `([А-ЯЁ][а-яё-]+)(?:\\s+([А-ЯЁ][а-яё-]+))?\\s*[,—–-]?\\s+(?:${ROLE_ALTERNATION})(?![а-яёa-z])`,
  "iu"
)
const NAME_INTRO =
  /(?:меня зовут|моё имя|мое имя|это)\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/iu
const NAME_SIGNATURE =
  /(?:с уважением|всего доброго|хорошего дня)[,\s]+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/iu
const NOT_NAMES = new Set([
  "добрый",
  "здравствуйте",
  "спасибо",
  "резюме",
  "вакансия",
  "компания",
  "телеграм",
  "telegram",
  "связь",
  "пишите",
  "напишите"
])

export const isBotUsername = (username: string): boolean => /bot$/iu.test(username)

/** `+79991234567`, or null when the digits are a year, price or an INN. */
export const normalizePhone = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (trimmed === "") return null

  const explicitPlus = trimmed.startsWith("+")
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 15) return null

  if (explicitPlus) {
    if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`
    return `+${digits}`
  }

  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`
  return null
}

const hasTelegramContext = (text: string): boolean => {
  if (/telegram|telegramm|телеграм|телеге|телегу|телега|t\.me|telegram\.me/i.test(text)) {
    return true
  }
  if (/(?:^|[^\p{L}])тг(?:$|[^\p{L}])/iu.test(text)) return true
  if (/(?:^|[^\p{L}])tg(?:$|[^\p{L}])/iu.test(text)) return true
  return /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(text.trim())
}

const evidenceFor = (text: string, raw: string): string => {
  const at = text.indexOf(raw)
  if (at < 0) return text.replace(/\s+/g, " ").trim().slice(0, 240)

  const lineStart = text.lastIndexOf("\n", at) + 1
  const lineEnd = text.indexOf("\n", at + raw.length)
  const line = text
    .slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
    .replace(/\s+/g, " ")
    .trim()
  return line.length > 300 ? `${line.slice(0, 297)}…` : line
}

const meaningfulName = (value: string | null | undefined): string | null => {
  const trimmed = value?.replace(/\s+/g, " ").trim()
  if (!trimmed) return null
  const first = trimmed.split(/\s+/)[0]?.toLocaleLowerCase("ru") ?? ""
  return NOT_NAMES.has(first) ? null : trimmed
}

const attribute = (
  text: string,
  context: ContactContext
): { personName: string | null; personRole: string | null } => {
  let personName = meaningfulName(context.senderName)
  let personRole = context.senderRole?.trim() || null

  if (personName === null) {
    const beforeRole = NAME_BEFORE_ROLE.exec(text)
    if (beforeRole) {
      personName = meaningfulName(
        [beforeRole[1], beforeRole[2]].filter(Boolean).join(" ")
      )
    }
  }
  if (personName === null) {
    const intro = NAME_INTRO.exec(text) ?? NAME_SIGNATURE.exec(text)
    if (intro) personName = meaningfulName(intro[1])
  }
  if (personRole === null) {
    const role = ROLE_PATTERN.exec(text)
    if (role) personRole = role[0].replace(/\s+/g, " ").trim()
  }

  return { personName, personRole }
}

const dedupe = (items: ReadonlyArray<ContactCandidate>): ContactCandidate[] => {
  const byKey = new Map<string, ContactCandidate>()
  for (const item of items) {
    const key = `${item.kind}:${item.value}`
    const previous = byKey.get(key)
    if (previous === undefined) {
      byKey.set(key, item)
      continue
    }
    byKey.set(key, {
      ...previous,
      raw: previous.raw || item.raw,
      url: previous.url ?? item.url,
      evidence: previous.evidence || item.evidence,
      confidence: Math.max(previous.confidence, item.confidence),
      personName: previous.personName ?? item.personName,
      personRole: previous.personRole ?? item.personRole,
      isBot: previous.isBot || item.isBot
    })
  }
  return [...byKey.values()]
}

/**
 * Extracts every contact and hh vacancy reference from one text. Duplicates
 * collapse by normalized value; a bot never keeps a human name or role.
 */
export const extractContactsFromText = (
  source: string,
  context: ContactContext = {}
): ContactExtraction => {
  if (source.trim() === "") return { contacts: [], vacancyIds: [] }

  const text = source.replace(/\u00A0/g, " ")
  const attribution = attribute(text, context)
  const found: Array<ContactCandidate> = []
  const vacancyIds: Array<string> = []
  const seenVacancies = new Set<string>()
  const addVacancy = (id: string): void => {
    if (seenVacancies.has(id)) return
    seenVacancies.add(id)
    vacancyIds.push(id)
  }

  for (const match of text.matchAll(EMAIL)) {
    const raw = match[0]
    const value = raw.toLowerCase().replace(/\.+$/, "")
    const domain = value.slice(value.lastIndexOf(".") + 1)
    if (FILE_EXTENSIONS.has(domain)) continue

    found.push({
      kind: "email",
      value,
      raw,
      url: `mailto:${value}`,
      evidence: evidenceFor(text, raw),
      confidence: 0.95,
      ...attribution,
      isBot: false
    })
  }

  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const raw = match[0].trim()
    const value = normalizePhone(raw)
    if (value === null) continue

    const explicit = raw.startsWith("+") || raw.includes("(")
    found.push({
      kind: "phone",
      value,
      raw,
      url: `tel:${value}`,
      evidence: evidenceFor(text, match[0]),
      confidence: explicit ? 0.9 : 0.8,
      ...attribution,
      isBot: false
    })
  }

  for (const match of text.matchAll(HH_VACANCY_URL)) {
    const id = match[1]
    if (id !== undefined) addVacancy(id)
  }
  for (const match of text.matchAll(HH_VACANCY_ID)) {
    const id = match[1]
    if (id !== undefined) addVacancy(id)
  }

  for (const match of text.matchAll(HH_CHAT_LINK)) {
    const raw = match[0].trim()
    const path = match[1]?.replace(/\/+$/, "") ?? ""
    const url = `https://hh.ru/chat${path === "" ? "" : `/${path}`}`
    found.push({
      kind: "hh_chat",
      value: url,
      raw,
      url,
      evidence: evidenceFor(text, match[0]),
      confidence: 0.85,
      ...attribution,
      isBot: false
    })
  }

  const telegramUrls = [
    ...text.matchAll(TELEGRAM_USERNAME_URL),
    ...text.matchAll(TELEGRAM_RESOLVE)
  ]
  for (const match of telegramUrls) {
    const username = match[1]
    if (username === undefined || RESERVED_USERNAMES.has(username.toLowerCase())) continue

    found.push({
      kind: "telegram",
      value: `@${username.toLowerCase()}`,
      raw: match[0].trim(),
      url: `https://t.me/${username}`,
      evidence: evidenceFor(text, match[0]),
      confidence: 0.95,
      ...attribution,
      isBot: isBotUsername(username)
    })
  }

  for (const match of text.matchAll(TELEGRAM_INVITE)) {
    const raw = match[0].trim()
    const invite = /^https?:\/\//iu.test(raw) ? raw : `https://${raw}`
    found.push({
      kind: "telegram",
      value: invite,
      raw,
      url: invite,
      evidence: evidenceFor(text, match[0]),
      confidence: 0.9,
      ...attribution,
      isBot: false
    })
  }

  if (context.channel === "telegram" || hasTelegramContext(text)) {
    for (const match of text.matchAll(TELEGRAM_HANDLE)) {
      const username = match[1]
      if (username === undefined || RESERVED_USERNAMES.has(username.toLowerCase())) continue

      found.push({
        kind: "telegram",
        value: `@${username.toLowerCase()}`,
        raw: match[0],
        url: `https://t.me/${username}`,
        evidence: evidenceFor(text, match[0]),
        confidence: 0.9,
        ...attribution,
        isBot: isBotUsername(username)
      })
    }
  }

  const contacts = dedupe(
    found.map((contact) =>
      contact.isBot ? { ...contact, personName: null, personRole: null } : contact
    )
  )

  return { contacts, vacancyIds }
}

/** Convenience for callers that only need the vacancy references. */
export const extractVacancyIds = (source: string): ReadonlyArray<string> =>
  extractContactsFromText(source).vacancyIds
