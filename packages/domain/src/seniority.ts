import type { Seniority } from "@otbor/contract"
import { normalizeText } from "./text.ts"

const JUNIOR =
  /(?<![\p{L}\p{N}_])(junior|intern|trainee|джун\p{L}*|стажер\p{L}*|начинающ\p{L}*)(?![\p{L}\p{N}_])/iu
const MIDDLE = /(?<![\p{L}\p{N}_])(middle|мидл\p{L}*)(?![\p{L}\p{N}_])/iu
const SENIOR =
  /(?<![\p{L}\p{N}_])(senior|principal|staff|сеньор\p{L}*|ведущ\p{L}*|старш\p{L}*)(?![\p{L}\p{N}_])/iu
const LEAD =
  /(?<![\p{L}\p{N}_])(lead|head|руководител\p{L}*|директор\p{L}*)(?![\p{L}\p{N}_])/iu

/**
 * Seniority is descriptive, never a hard filter. A lead role is a different
 * conversation, not a reason to hide the vacancy.
 */
export const detectSeniority = (title: string, body = ""): Seniority => {
  const titleText = normalizeText(title)
  const bodyText = normalizeText(body)

  const check = (pattern: RegExp, text: string): boolean => {
    pattern.lastIndex = 0
    return pattern.test(text)
  }

  if (check(LEAD, titleText) || check(LEAD, bodyText)) return "lead"
  if (check(SENIOR, titleText) || check(SENIOR, bodyText)) return "senior"
  if (check(MIDDLE, titleText) || check(MIDDLE, bodyText)) return "middle"
  if (check(JUNIOR, titleText) || check(JUNIOR, bodyText)) return "junior"
  return "unknown"
}
