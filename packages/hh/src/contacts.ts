import { normalizePhone } from "@otbor/domain"

/** Собственные контакты соискателя из блока «Контакты» на странице профиля hh. */
export interface ProfileContacts {
  readonly phone: string | null
  readonly email: string | null
  readonly telegram: string | null
}

export type ProfileContactKind = "phone" | "email" | "telegram"

export interface ProfileContact {
  readonly kind: ProfileContactKind
  readonly value: string
  /** Строка из блока как есть, до нормализации. */
  readonly raw: string
}

const LABELS: ReadonlyArray<readonly [ProfileContactKind | "other", RegExp]> = [
  ["phone", /^(?:телефон|мобильный телефон|phone)$/iu],
  ["email", /^(?:почта|эл\.? ?почта|электронная почта|e-?mail)$/iu],
  ["telegram", /^(?:telegram|телеграм|телеграмм)$/iu],
  ["other", /^(?:контакты|другие контакты|сайт|сайты|предпочитаемый способ связи|whatsapp|viber|skype|vk|вконтакте|ссылки?)$/iu]
]

const PREFERRED = /^предпочитаемый способ связи$/iu

const labelOf = (line: string): ProfileContactKind | "other" | null => {
  const clean = line.replace(/:$/u, "").trim()
  for (const [kind, pattern] of LABELS) if (pattern.test(clean)) return kind
  return null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u
const HANDLE = /^[a-z][a-z0-9_]{3,31}$/u

const normalizeEmail = (raw: string): string | null => {
  const value = raw.trim().toLowerCase()
  return EMAIL.test(value) ? value : null
}

/** `@username` в нижнем регистре из `@name`, `t.me/name`, `https://t.me/name` или голого имени. */
const normalizeTelegram = (raw: string): string | null => {
  let value = raw.trim().toLowerCase()
  value = value.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//u, "")
  value = value.replace(/[/?#].*$/u, "").replace(/^@/u, "")
  return HANDLE.test(value) ? `@${value}` : null
}

const normalizers: Record<ProfileContactKind, (raw: string) => string | null> = {
  phone: normalizePhone,
  email: normalizeEmail,
  telegram: normalizeTelegram
}

/** Есть ли в тексте заголовок «Контакты»: без него отсутствие значений ничего не доказывает. */
export const hasContactsHeading = (text: string): boolean => /(^|\n)\s*Контакты\s*(\n|$)/iu.test(text)

/**
 * Разбирает видимый текст блока «Контакты» (подпись и значение на отдельных
 * строках). Значение берётся из ближайшей непустой строки после подписи; если
 * там сразу другая подпись, значения нет. Подпись и значение через двоеточие в
 * одной строке тоже понимаются.
 */
export const parseProfileContactList = (text: string): ReadonlyArray<ProfileContact> => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  const found = new Map<ProfileContactKind, ProfileContact>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (PREFERRED.test(line.replace(/:$/u, "").trim())) {
      // Значение этой подписи («Telegram», «Телефон») само похоже на подпись.
      i += 1
      continue
    }
    let kind = labelOf(line)
    let raw: string | null = null
    if (kind === null) {
      const inline = /^([^:]{2,40}):\s*(.+)$/u.exec(line)
      const inlineKind = inline === null ? null : labelOf(inline[1]!)
      if (inline === null || inlineKind === null) continue
      kind = inlineKind
      raw = inline[2]!.trim()
    } else {
      const next = lines[i + 1]
      if (next !== undefined && labelOf(next) === null) raw = next
    }
    if (kind === "other" || found.has(kind)) continue
    if (raw === null) continue
    const value = normalizers[kind](raw)
    if (value !== null) found.set(kind, { kind, value, raw })
  }
  return [...found.values()]
}

export const parseProfileContacts = (text: string): ProfileContacts => {
  const list = parseProfileContactList(text)
  const pick = (kind: ProfileContactKind): string | null =>
    list.find((item) => item.kind === kind)?.value ?? null
  return { phone: pick("phone"), email: pick("email"), telegram: pick("telegram") }
}
