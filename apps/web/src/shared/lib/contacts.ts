import type { ContactRecord } from "@otbor/contract"

/**
 * Contacts store a display value and, for scraped links, the href the source
 * actually carried. Mail and phone values need a scheme before they are safe
 * to render as links; everything else only links when it really is a URL.
 */
export const contactHref = (
  contact: Pick<ContactRecord, "kind" | "value" | "url">
): string | null => {
  if (contact.url !== null && contact.url !== "") return contact.url

  const value = contact.value.trim()
  if (value === "") return null

  switch (contact.kind) {
    case "email":
      return value.startsWith("mailto:") ? value : `mailto:${value}`
    case "phone":
      return value.startsWith("tel:") ? value : `tel:${value.replace(/[^\d+]/g, "")}`
    case "telegram": {
      if (/^https?:\/\//i.test(value)) return value
      return `https://t.me/${value.replace(/^@/, "")}`
    }
    case "hh_chat":
    case "other":
      return /^https?:\/\//i.test(value) ? value : null
    default:
      return null
  }
}
