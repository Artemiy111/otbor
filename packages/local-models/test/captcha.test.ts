import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  decodePng,
  encodeGrayPng,
  prepareCaptchaImage,
  cleanCaptchaAnswer,
  loadCaptchaSolver,
  readCaptchaSettings,
  recognizeCaptcha,
  writeCaptchaSettings
} from "../src/index.ts"

const dirs: Array<string> = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "otbor-captcha-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("captcha settings", () => {
  test("нет файла — распознавание выключено", () => {
    const dir = temp()
    expect(readCaptchaSettings(join(dir, "captcha.json")).enabled).toBe(false)
    expect(loadCaptchaSolver({ OTBOR_HARNESS_DIR: dir })).toBeNull()
  })

  test("локальный сервер даёт endpoint, агент ACP — null", () => {
    const dir = temp()
    writeFileSync(
      join(dir, "openai.json"),
      JSON.stringify({ endpoints: [{ id: "omlx", url: "http://127.0.0.1:1111/v1" }] })
    )
    const base = { enabled: true, model: "gemma", maxAttempts: 5, timeoutSeconds: 60, filter: "normalize" as const }
    writeCaptchaSettings({ ...base, harnessId: "omlx" }, join(dir, "captcha.json"))
    expect(loadCaptchaSolver({ OTBOR_HARNESS_DIR: dir })?.endpoint?.id).toBe("omlx")
    writeCaptchaSettings({ ...base, harnessId: "opencode" }, join(dir, "captcha.json"))
    const agent = loadCaptchaSolver({ OTBOR_HARNESS_DIR: dir })
    expect(agent?.harnessId).toBe("opencode")
    expect(agent?.endpoint).toBeNull()
  })
})

describe("cleanCaptchaAnswer", () => {
  test("убирает размышления, кавычки и точку, сохраняя пробел", () => {
    expect(cleanCaptchaAnswer("<think>так...</think>\n«изгибистую раёк».")).toBe("изгибистую раёк")
    expect(cleanCaptchaAnswer('"abc  def"\nпояснение')).toBe("abc def")
  })
})

describe("recognizeCaptcha", () => {
  test("шлёт картинку data URI и возвращает чистый ответ", async () => {
    let body: any
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        body = await request.json()
        return Response.json({ choices: [{ message: { content: " Привет. " } }] })
      }
    })
    try {
      const result = await recognizeCaptcha(
        { endpoint: { id: "t", url: `http://127.0.0.1:${server.port}/v1` }, model: "m", timeoutSeconds: 5 },
        new Uint8Array([1, 2, 3])
      )
      expect(result).toMatchObject({ ok: true, text: "Привет" })
      expect(body.model).toBe("m")
      expect(body.messages[0].content[1].image_url.url).toStartWith("data:image/png;base64,AQID")
    } finally {
      await server.stop(true)
    }
  })

  test("недоступный сервер — ok:false, unavailable:true, а не исключение", async () => {
    const result = await recognizeCaptcha(
      { endpoint: { id: "t", url: "http://127.0.0.1:1/v1" }, model: "m", timeoutSeconds: 2 },
      new Uint8Array([1])
    )
    expect(result.ok).toBe(false)
    expect(result.error).not.toBeNull()
    // Решать нечем: повтор с новой картинкой не поможет.
    expect(result.unavailable).toBe(true)
  })

  test("пустой ответ при живом сервере — обычный промах, unavailable:false", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async () => Response.json({ choices: [{ message: { content: "  " } }] })
    })
    try {
      const result = await recognizeCaptcha(
        { endpoint: { id: "t", url: `http://127.0.0.1:${server.port}/v1` }, model: "m", timeoutSeconds: 5 },
        new Uint8Array([1])
      )
      expect(result).toMatchObject({ ok: false, text: null, unavailable: false })
    } finally {
      await server.stop(true)
    }
  })
})

describe("prepareCaptchaImage", () => {
  const png = (w: number, h: number, fill: (x: number, y: number) => number) =>
    encodeGrayPng({ width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => fill(i % w, Math.floor(i / w))) })

  test("none отдаёт оригинал", async () => {
    const source = png(8, 8, () => 200)
    const result = await prepareCaptchaImage(source, "none")
    expect(result.filter).toBe("none")
    expect(result.image).toBe(source)
  })

  test("normalize выравнивает фон до белого и оставляет штрих тёмным", async () => {
    // Градиент фона 120..220 и тёмный штрих.
    const source = png(60, 20, (x, y) => (x === 30 && y > 3 && y < 16 ? 20 : 120 + x))
    const result = await prepareCaptchaImage(source, "normalize")
    expect(result.filter).toBe("normalize")
    const out = decodePng(result.image)
    const at = (x: number, y: number) => out.data[(y * out.width + x) * 4]!
    expect(at(5, 10)).toBeGreaterThan(220)
    expect(at(55, 10)).toBeGreaterThan(220)
    expect(at(30, 10)).toBeLessThan(120)
  })

  test("не PNG - оригинал и честный none", async () => {
    const result = await prepareCaptchaImage(new Uint8Array([1, 2, 3]), "normalize")
    expect(result.filter).toBe("none")
  })
})
