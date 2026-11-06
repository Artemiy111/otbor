/**
 * How an hh account looks in every UI (web and the browser extension): a
 * coloured circle with initials. Pure functions, so both draw the same circle.
 */

/** Stable hue (0-359) per account id, so the same account is always the same colour. */
export const hhAccountHue = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

const hslToHex = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value).toString(16).padStart(2, "0")
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** The automatic colour an account has until the operator picks one. */
export const defaultHhAccountColor = (id: string): string => hslToHex(hhAccountHue(id), 0.55, 0.42)

/** Up to two initials from the display name. */
export const hhAccountInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((part) => part !== "")
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase())
  return letters.length === 0 ? "?" : letters.join("")
}
