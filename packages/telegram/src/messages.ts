/**
 * Telegram tracks read state with a per-side watermark, not with a flag per
 * message: every id up to `readInboxMaxId` (incoming) or `readOutboxMaxId`
 * (outgoing, read by the other side) counts as read.
 */

import type { TelegramDialog, TelegramMessage } from "./types.ts"

export type ReadWatermarks = Pick<
  TelegramDialog,
  "readInboxMaxId" | "readOutboxMaxId"
>

export const messageReadUpTo = (
  messageId: string,
  watermark: number | null | undefined
): boolean => {
  if (watermark === null || watermark === undefined) return false
  const id = Number(messageId)
  return Number.isInteger(id) && id > 0 && id <= watermark
}

/** Picks the watermark that belongs to the message direction. */
export const messageRead = (
  message: Pick<TelegramMessage, "id" | "direction">,
  dialog: ReadWatermarks
): boolean =>
  messageReadUpTo(
    message.id,
    message.direction === "in" ? dialog.readInboxMaxId : dialog.readOutboxMaxId
  )
