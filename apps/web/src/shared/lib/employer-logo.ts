/**
 * Адрес логотипа работодателя на нашем сервере: он хранит сжатую копию в базе,
 * поэтому страница не ходит за картинкой на CDN hh. Источник адреса не нужен,
 * сервер сам знает, откуда качать; нет логотипа у компании, значит null.
 */
const apiOrigin = (): string => {
  if (__OTBOR_API_URL__ === "") return ""
  try {
    return new URL(__OTBOR_API_URL__).origin
  } catch {
    // Относительный адрес RPC: сервер на том же origin.
    return ""
  }
}

export const employerLogoSrc = (
  employerId: string | null | undefined,
  logoUrl: string | null | undefined
): string | null =>
  employerId && logoUrl ? `${apiOrigin()}/employer-logo/${employerId}` : null
