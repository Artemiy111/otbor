import type { HhAccountRecord } from "@otbor/contract"
import { hhAccountHue } from "./model"

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

/** The account's colour (#rrggbb): the one stored on the server, else the automatic one. */
export const hhAccountColor = (account: Pick<HhAccountRecord, "id" | "color">): string =>
  account.color ?? defaultHhAccountColor(account.id)

/** Colour by id; an unknown id still gets its stable automatic colour. */
export const hhAccountColorById = (
  accounts: ReadonlyArray<Pick<HhAccountRecord, "id" | "color">>,
  id: string
): string => {
  const account = accounts.find((candidate) => candidate.id === id)
  return account === undefined ? defaultHhAccountColor(id) : hhAccountColor(account)
}
