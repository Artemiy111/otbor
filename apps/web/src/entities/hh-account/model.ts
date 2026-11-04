import type { HhAccountRecord } from "@otbor/contract"

export const hhAccountKeys = {
  all: ["hh-accounts"] as const,
  list: () => ["hh-accounts", "list"] as const
}

/** hh display name ("firstName lastName"), else the operator's label. */
export const hhAccountName = (
  account: Pick<HhAccountRecord, "label" | "firstName" | "lastName">
): string => {
  const full = [account.firstName, account.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ")
  return full === "" ? account.label : full
}

/** The account's display name by id; an unknown id falls back to a short id. */
export const hhAccountNameById = (
  accounts: ReadonlyArray<HhAccountRecord>,
  id: string | null | undefined
): string => {
  if (id === null || id === undefined) return ""
  const account = accounts.find((candidate) => candidate.id === id)
  return account === undefined ? id.slice(0, 8) : hhAccountName(account)
}

/** Stable hue (0-359) per account id, so the same account is always the same colour. */
export const hhAccountHue = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

/** Up to two initials from the display name. */
export const hhAccountInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((part) => part !== "")
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase())
  return letters.length === 0 ? "?" : letters.join("")
}
