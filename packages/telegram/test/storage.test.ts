import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  accountConfigPath,
  appConfigPath,
  assertAccountId,
  deleteAccountFiles,
  isValidAccountId,
  maskPhone,
  parseProxy,
  readAccountConfig,
  readAppConfig,
  readSession,
  telegramDir,
  writeAccountConfig,
  writeAppConfig,
  writeSession,
  type TelegramAccountConfig
} from "../src/storage.ts"

const dir = await mkdtemp(join(tmpdir(), "otbor-telegram-"))
const env = { OTBOR_TELEGRAM_DIR: dir }

const account: TelegramAccountConfig = {
  id: "tg_main",
  phoneMasked: "+79***4567",
  proxy: parseProxy("socks5://user:pass@127.0.0.1:7897"),
  createdAt: "2026-11-02T00:00:00.000Z"
}

const mode = async (path: string): Promise<number> =>
  (await stat(path)).mode & 0o777

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("telegram credentials directory", () => {
  test("defaults to ~/.otbor/telegram and honors the override", () => {
    expect(telegramDir({})).toBe(join(homedir(), ".otbor", "telegram"))
    expect(telegramDir({ OTBOR_TELEGRAM_DIR: ` ${dir} ` })).toBe(dir)
    expect(telegramDir({ OTBOR_TELEGRAM_DIR: "  " })).toBe(
      join(homedir(), ".otbor", "telegram")
    )
  })

  test("creates the directory with 0700", async () => {
    await writeAppConfig({ apiId: 123, apiHash: "hash" }, env)
    expect(await mode(dir)).toBe(0o700)
  })

  test("round-trips the application credentials with 0600", async () => {
    await writeAppConfig({ apiId: 123, apiHash: "secret-hash" }, env)
    expect(await readAppConfig(env)).toEqual({
      apiId: 123,
      apiHash: "secret-hash"
    })
    expect(await mode(appConfigPath(env))).toBe(0o600)
  })

  test("round-trips the account config and session with 0600", async () => {
    await writeAccountConfig(account, env)
    await writeSession("tg_main", "  session-string\n", env)

    expect(await readAccountConfig("tg_main", env)).toEqual(account)
    expect(await readSession("tg_main", env)).toBe("session-string")
    expect(await mode(accountConfigPath("tg_main", env))).toBe(0o600)
    expect(await mode(join(dir, "tg_main.session"))).toBe(0o600)
  })

  test("missing files read as null", async () => {
    expect(await readAccountConfig("tg_absent", env)).toBeNull()
    expect(await readSession("tg_absent", env)).toBeNull()
  })

  test("deletes settings and session", async () => {
    await writeAccountConfig(account, env)
    await writeSession("tg_main", "session-string", env)

    await deleteAccountFiles("tg_main", env)

    expect(await readAccountConfig("tg_main", env)).toBeNull()
    expect(await readSession("tg_main", env)).toBeNull()
  })

  test("rejects broken JSON instead of returning a partial config", async () => {
    await writeFile(appConfigPath(env), "not json", { mode: 0o600 })
    await expect(readAppConfig(env)).rejects.toThrow(/invalid JSON/)
    await writeAppConfig({ apiId: 1, apiHash: "h" }, env)
  })
})

describe("account ids", () => {
  test("accepts namespaced ids", () => {
    for (const id of ["tg_main", "acc-1", "tg:work", "A0"]) {
      expect(isValidAccountId(id)).toBe(true)
      expect(assertAccountId(id)).toBe(id)
    }
  })

  test("rejects path traversal and empty ids", () => {
    for (const id of [
      "",
      "../evil",
      "a/b",
      "..",
      "a b",
      ".hidden",
      "a".repeat(65),
      "телеграм"
    ]) {
      expect(isValidAccountId(id)).toBe(false)
      expect(() => assertAccountId(id)).toThrow(/Invalid Telegram account id/)
    }
  })

  test("refuses to write files for an invalid id", async () => {
    const before = (await readdir(dir)).sort()
    await expect(
      writeAccountConfig({ ...account, id: "../evil" }, env)
    ).rejects.toThrow(/Invalid Telegram account id/)
    expect((await readdir(dir)).sort()).toEqual(before)
  })
})

describe("maskPhone", () => {
  test("keeps the country code and the last four digits", () => {
    expect(maskPhone("+79991234567")).toBe("+79***4567")
    expect(maskPhone("8 (999) 123-45-67")).toBe("89***4567")
    expect(maskPhone(" +7 999 123 45 67 ")).toBe("+79***4567")
  })

  test("handles empty and very short numbers", () => {
    expect(maskPhone(null)).toBeNull()
    expect(maskPhone(undefined)).toBeNull()
    expect(maskPhone("   ")).toBeNull()
    expect(maskPhone("123")).toBe("***")
  })
})

describe("proxy parsing", () => {
  test("reads socks5 and socks4 endpoints", () => {
    expect(parseProxy("socks5://127.0.0.1:7897")).toEqual({
      kind: "socks5",
      host: "127.0.0.1",
      port: 7897
    })
    expect(parseProxy("socks4://user:p%40ss@proxy.local:1080")).toEqual({
      kind: "socks4",
      host: "proxy.local",
      port: 1080,
      username: "user",
      password: "p@ss"
    })
    expect(parseProxy("127.0.0.1:1080")).toEqual({
      kind: "socks5",
      host: "127.0.0.1",
      port: 1080
    })
  })

  test("treats blank as no proxy and rejects malformed values", () => {
    expect(parseProxy(null)).toBeNull()
    expect(parseProxy("  ")).toBeNull()
    expect(() => parseProxy("socks5://host")).toThrow(/Invalid proxy/)
    expect(() => parseProxy("socks5://host:0")).toThrow(/Invalid proxy/)
    expect(() => parseProxy("socks5://host:70000")).toThrow(/Invalid proxy/)
  })
})
