import { describe, expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { LOGO_DOWNLOAD_LIMIT, LOGO_MAX_SIDE, shrinkLogo } from "../src/services/logoShrink.ts"

/** CRC32 для чанков png. */
const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.byteLength)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, tail])
}

/** Однотонный rgb-png заданного размера: настоящий файл, который декодирует Bun.Image. */
const solidPng = (side: number): Uint8Array => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8 // глубина
  header[9] = 2 // rgb
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 120)])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", pixels),
      chunk("IEND", new Uint8Array())
    ])
  )
}

describe("shrinkLogo", () => {
  test("большая картинка ужимается до предельной стороны в webp", async () => {
    const input = solidPng(600)
    const result = await shrinkLogo(input, "image/png")
    expect(result).not.toBeNull()
    expect(result!.contentType).toBe("image/webp")
    expect(Math.max(result!.width!, result!.height!)).toBe(LOGO_MAX_SIDE)
    expect(result!.bytes.byteLength).toBeLessThan(input.byteLength)
  })

  test("маленький файл хранится как есть", async () => {
    const input = solidPng(32)
    const result = await shrinkLogo(input, "image/png")
    expect(result!.contentType).toBe("image/png")
    expect(result!.bytes).toBe(input)
  })

  test("не картинка и слишком тяжёлый файл отбрасываются", async () => {
    expect(await shrinkLogo(new Uint8Array([1, 2, 3]), "image/png")).toBeNull()
    expect(await shrinkLogo(new Uint8Array(LOGO_DOWNLOAD_LIMIT + 1), "image/png")).toBeNull()
  })

  test("маленький svg сохраняется, большой нет", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect((await shrinkLogo(svg, "image/svg+xml"))!.contentType).toBe("image/svg+xml")
    expect(await shrinkLogo(new Uint8Array(40 * 1024).fill(32), "image/svg+xml")).toBeNull()
  })
})
