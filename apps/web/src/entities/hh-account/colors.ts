import type { HhAccountRecord } from "@otbor/contract"
import { defaultHhAccountColor } from "@otbor/contract"

export { defaultHhAccountColor }

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
