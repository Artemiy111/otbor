import { createHash } from "node:crypto"
import type { MailAddress } from "./types.ts"

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™"
}

export const SNIPPET_LIMIT = 300

const decodeEntities = (input: string): string =>
  input.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));/g,
    (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10)
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16)
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole
      }
      if (name === undefined) return whole
      return NAMED_ENTITIES[name.toLowerCase()] ?? whole
    }
  )

/** Strip tags and entities so an HTML-only message still has readable text. */
export const htmlToText = (input: string | null | undefined): string => {
  if (!input) return ""
  return decodeEntities(
    input
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|section|table|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Prefer text/plain and only fall back to HTML when there is no text part. */
export const plainText = (input: {
  text?: string | false | null
  html?: string | false | null
}): string => {
  const text =
    typeof input.text === "string" ? input.text.replace(/\u00a0/g, " ").trim() : ""
  if (text.length > 0) return text
  return typeof input.html === "string" ? htmlToText(input.html) : ""
}

export const normalizeAddress = (value: string): string => value.trim().toLowerCase()

export const normalizeMessageId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/^<+/, "").replace(/>+$/, "").trim()
  return cleaned.length > 0 ? cleaned : null
}

export const normalizeMessageIds = (value: string | string[] | null | undefined): string[] => {
  if (!value) return []
  const list = Array.isArray(value) ? value : value.split(/\s+/)
  return list
    .map((item) => normalizeMessageId(item))
    .filter((item): item is string => item !== null)
}

export const toMailAddresses = (
  value:
    | Array<{ name?: string | null | undefined; address?: string | null | undefined }>
    | null
    | undefined
): MailAddress[] => {
  if (!value) return []
  return value
    .filter((item): item is { name?: string | null | undefined; address: string } =>
      Boolean(item.address?.trim())
    )
    .map((item) => ({
      name: item.name?.trim() || null,
      address: normalizeAddress(item.address)
    }))
}

/** Collapse whitespace and cut to a preview that fits in a list row. */
export const snippetOf = (text: string, limit = SNIPPET_LIMIT): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= limit) return flat
  const cut = Math.max(limit - 1, 0)
  return `${flat.slice(0, cut).trimEnd()}…`
}

/**
 * Stable Message-ID for servers that omit the header. It must not change
 * between syncs, so it is derived from account, folder and UID only.
 */
export const syntheticMessageId = (account: string, folder: string, uid: number): string => {
  const digest = createHash("sha256")
    .update(`${normalizeAddress(account)}\u0000${folder}\u0000${uid}`)
    .digest("hex")
    .slice(0, 24)
  return `synthetic-${digest}@mail.otbor`
}
