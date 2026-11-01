/**
 * HTML helpers. hh descriptions are HTML, often HTML-escaped a second time,
 * so decoding is done before tag stripping and once more after it.
 */

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

export const decodeEntities = (input: string): string =>
  input.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));/g,
    (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      if (name === undefined) return whole
      return NAMED_ENTITIES[name.toLowerCase()] ?? whole
    }
  )

const stripTags = (input: string): string =>
  input
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section|blockquote|table)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")

export const htmlToText = (input: string | null | undefined): string => {
  if (!input) return ""
  let text = stripTags(decodeEntities(input))
  text = decodeEntities(text)
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export const decodeOnce = (input: string): string =>
  input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
