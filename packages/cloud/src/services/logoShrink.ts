/**
 * Сжатие логотипа работодателя перед записью в базу.
 *
 * Чистая функция без ввода-вывода: байты на входе, байты на выходе. Логотип
 * показывается самое большее в 80 css-пикселей, поэтому хватает стороны 192 px
 * (запас под экраны с плотностью 2x). Мелкие файлы не трогаем: пережатие
 * маленького png только портит картинку.
 */

/** Наибольшая сторона сохранённого логотипа. */
export const LOGO_MAX_SIDE = 192
/** Файл не больше этого размера и в пределах стороны хранится как есть. */
export const LOGO_KEEP_BYTES = 12 * 1024
/** Скачивание сверх этого размера отбрасывается: это не логотип. */
export const LOGO_DOWNLOAD_LIMIT = 4 * 1024 * 1024
/** Потолок для svg: его растеризовать нечем, поэтому берём только маленький. */
export const LOGO_SVG_LIMIT = 32 * 1024

export interface ShrunkLogo {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly width: number | null
  readonly height: number | null
  readonly originalBytes: number
}

const looksLikeSvg = (bytes: Uint8Array, declared: string): boolean => {
  if (declared.includes("svg")) return true
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase()
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))
}

const keepMime = (format: string): string | null =>
  format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : null

/** Null, если файл не картинка или слишком тяжёл; тогда веб остаётся на адресе hh. */
export const shrinkLogo = async (
  input: Uint8Array,
  declaredType: string
): Promise<ShrunkLogo | null> => {
  if (input.byteLength === 0 || input.byteLength > LOGO_DOWNLOAD_LIMIT) return null

  if (looksLikeSvg(input, declaredType.toLowerCase())) {
    return input.byteLength <= LOGO_SVG_LIMIT
      ? { bytes: input, contentType: "image/svg+xml", width: null, height: null, originalBytes: input.byteLength }
      : null
  }

  try {
    const image = new Bun.Image(input)
    const meta = await image.metadata()
    if (!meta.width || !meta.height) return null

    const fits = meta.width <= LOGO_MAX_SIDE && meta.height <= LOGO_MAX_SIDE
    const mime = keepMime(meta.format)
    if (fits && mime !== null && input.byteLength <= LOGO_KEEP_BYTES) {
      return {
        bytes: input,
        contentType: mime,
        width: meta.width,
        height: meta.height,
        originalBytes: input.byteLength
      }
    }

    const scale = fits ? 1 : LOGO_MAX_SIDE / Math.max(meta.width, meta.height)
    const width = Math.max(1, Math.round(meta.width * scale))
    const height = Math.max(1, Math.round(meta.height * scale))
    const encoded = new Uint8Array(
      await (fits ? new Bun.Image(input) : new Bun.Image(input).resize(width, height)).webp({ quality: 82 }).bytes()
    )
    // Пережатие не должно раздувать файл, который и так влезал в рамки.
    if (fits && mime !== null && encoded.byteLength >= input.byteLength) {
      return { bytes: input, contentType: mime, width: meta.width, height: meta.height, originalBytes: input.byteLength }
    }
    return { bytes: encoded, contentType: "image/webp", width, height, originalBytes: input.byteLength }
  } catch {
    return null
  }
}
