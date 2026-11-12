/**
 * Подготовка картинки капчи перед отправкой модели зрения.
 *
 * Фильтр выбран по эксперименту (итоги в `captcha-image.md` рядом): нормировка на
 * локальный средний фон (`norm-30`) убирает полосы и градиент засветки hh, а
 * штрихи букв сохраняют форму. Другие варианты (глобальные пороги, адаптивная
 * бинаризация) на капче hh работали хуже исходника.
 */
import { deflateSync, inflateSync } from "node:zlib"

/** Какой фильтр применить к картинке капчи. */
export const CAPTCHA_FILTERS = ["none", "normalize"] as const
export type CaptchaFilter = (typeof CAPTCHA_FILTERS)[number]

/** Радиус окна среднего фона: заметно толще штриха буквы, сравним с неровностью фона. */
export const CAPTCHA_NORMALIZE_RADIUS = 30

type Rgba = { readonly width: number, readonly height: number, readonly data: Uint8Array }
type Gray = { readonly width: number, readonly height: number, readonly data: Uint8Array }

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** Декодировать 8-битный PNG без interlace (RGB/RGBA/серый) в RGBA. */
export const decodePng = (png: Uint8Array): Rgba => {
  for (let i = 0; i < 8; i++) if (png[i] !== SIGNATURE[i]) throw new Error("это не PNG")
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const channels = CHANNELS[png[25]!]
  if (png[24] !== 8 || png[28] !== 0 || channels === undefined) throw new Error("формат PNG не поддерживается")

  const parts: Array<Uint8Array> = []
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!)
    if (type === "IDAT") parts.push(png.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
    if (type === "IEND") break
  }
  if (parts.length === 0) throw new Error("в PNG нет IDAT")
  const raw = new Uint8Array(inflateSync(Buffer.concat(parts)))

  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]!
    for (let i = 0; i < stride; i++) {
      const x = raw[pos++]!
      const a = i >= channels ? row[i - channels]! : 0
      const b = prev[i]!
      const c = i >= channels ? prev[i - channels]! : 0
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c)
      if (filter > 4) throw new Error(`неизвестный PNG-фильтр ${filter}`)
      row[i] = (x + add) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels
      const dst = (y * width + x) * 4
      if (channels <= 2) {
        out[dst] = out[dst + 1] = out[dst + 2] = row[src]!
        out[dst + 3] = channels === 2 ? row[src + 1]! : 255
      } else {
        out[dst] = row[src]!
        out[dst + 1] = row[src + 1]!
        out[dst + 2] = row[src + 2]!
        out[dst + 3] = channels === 4 ? row[src + 3]! : 255
      }
    }
    const swap = prev
    prev = row
    row = swap
  }
  return { width, height, data: out }
}

/** Закодировать серую картинку в одноканальный PNG. */
export const encodeGrayPng = (gray: Gray): Uint8Array => {
  const { width, height, data } = gray
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0))
  ]
  return Buffer.concat(parts)
}

/** Яркость по Rec.601; прозрачность композитится поверх белого. */
const toGray = ({ width, height, data }: Rgba): Gray => {
  const out = new Uint8Array(width * height)
  const over = (value: number, alpha: number) => value * (alpha / 255) + 255 * (1 - alpha / 255)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = data[p + 3]!
    out[i] = Math.round(0.299 * over(data[p]!, a) + 0.587 * over(data[p + 1]!, a) + 0.114 * over(data[p + 2]!, a))
  }
  return { width, height, data: out }
}

/** Средний цвет в квадратном окне через интегральную картинку. */
const boxBlur = ({ width, height, data }: Gray, radius: number): Uint8Array => {
  const w1 = width + 1
  const integral = new Float64Array(w1 * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x]!
      integral[(y + 1) * w1 + x + 1] = integral[y * w1 + x + 1]! + rowSum
    }
  }
  const out = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const sum = integral[y1 * w1 + x1]! - integral[y1 * w1 + x0]! - integral[y0 * w1 + x1]! + integral[y0 * w1 + x0]!
      out[y * width + x] = Math.round(sum / ((x1 - x0) * (y1 - y0)))
    }
  }
  return out
}

/** Нормировка на локальный средний фон: фон становится белым, штрихи остаются. */
export const normalizeBackground = (gray: Gray, radius = CAPTCHA_NORMALIZE_RADIUS): Gray => {
  const background = boxBlur(gray, radius)
  const out = new Uint8Array(gray.data.length)
  for (let i = 0; i < out.length; i++) {
    const bg = background[i]!
    out[i] = bg === 0 ? 255 : Math.min(255, Math.round((gray.data[i]! * 255) / bg))
  }
  return { width: gray.width, height: gray.height, data: out }
}

export interface PreparedCaptchaImage {
  readonly image: Uint8Array
  /** Какой фильтр реально применён: `none`, если выключен или не удалось. */
  readonly filter: CaptchaFilter
}

/**
 * Картинка для модели. Не бросает: если PNG не разобрать, уходит исходник, а
 * `filter` честно говорит `none` - журнал не должен врать о том, что видела модель.
 */
export const prepareCaptchaImage = async (
  png: Uint8Array,
  filter: CaptchaFilter
): Promise<PreparedCaptchaImage> => {
  if (filter === "none") return { image: png, filter: "none" }
  try {
    const decoded = decodePng(png)
    return { image: encodeGrayPng(normalizeBackground(toGray(decoded))), filter }
  } catch {
    return { image: png, filter: "none" }
  }
}
