import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  MailError,
  accountSecretExists,
  assertAccountId,
  deleteAccountSecret,
  mailDir,
  readAccountSecret,
  writeAccountSecret,
  type MailSecret
} from "../src/index.ts"

const dirs: string[] = []

const tempEnv = async (): Promise<Record<string, string>> => {
  const dir = await mkdtemp(join(tmpdir(), "otbor-mail-"))
  dirs.push(dir)
  return { OTBOR_MAIL_DIR: dir }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const secret: MailSecret = {
  host: "imap.example.com",
  port: 993,
  secure: true,
  username: "me@example.com",
  password: "app password"
}

describe("mail secret storage", () => {
  test("round-trips a secret and keeps the directory private", async () => {
    const env = await tempEnv()
    const dir = env.OTBOR_MAIL_DIR as string

    expect(await readAccountSecret("acct:1", env)).toBeNull()
    await writeAccountSecret("acct:1", secret, env)

    expect(await readAccountSecret("acct:1", env)).toEqual(secret)
    expect(await accountSecretExists("acct:1", env)).toBe(true)
    expect((await stat(join(dir, "acct:1.secret.json"))).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  test("repairs loose permissions on an existing file", async () => {
    const env = await tempEnv()
    const dir = env.OTBOR_MAIL_DIR as string
    const path = join(dir, "acct.secret.json")

    await writeAccountSecret("acct", secret, env)
    await chmod(dir, 0o755)
    await chmod(path, 0o644)
    await writeAccountSecret("acct", secret, env)

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  test("writes JSON, not a database or a dotenv blob", async () => {
    const env = await tempEnv()
    await writeAccountSecret("acct", secret, env)
    const parsed = JSON.parse(await readFile(join(env.OTBOR_MAIL_DIR as string, "acct.secret.json"), "utf8"))
    expect(parsed).toEqual(secret)
  })

  test("defaults to ~/.otbor/mail and honors OTBOR_MAIL_DIR", () => {
    expect(mailDir({})).toBe(join(homedir(), ".otbor", "mail"))
    expect(mailDir({ OTBOR_MAIL_DIR: " /tmp/mail " })).toBe("/tmp/mail")
  })

  test("accepts only the documented account id alphabet", async () => {
    for (const id of ["acct:1", "a_b-c", "ABC123"]) {
      expect(() => assertAccountId(id)).not.toThrow()
    }
    for (const id of ["", "../escape", "a b", "a/b", "a.b", "acct\n"]) {
      expect(() => assertAccountId(id)).toThrow(MailError)
    }

    const env = await tempEnv()
    await expect(writeAccountSecret("../escape", secret, env)).rejects.toMatchObject({
      code: "invalid_account_id"
    })
    await expect(readAccountSecret("a/b", env)).rejects.toMatchObject({ code: "invalid_account_id" })
    await expect(deleteAccountSecret("a.b", env)).rejects.toMatchObject({ code: "invalid_account_id" })
  })

  test("rejects an incomplete secret without writing a file", async () => {
    const env = await tempEnv()
    await expect(
      writeAccountSecret("acct", { ...secret, port: 0 }, env)
    ).rejects.toMatchObject({ code: "bad_secret" })
    await expect(
      writeAccountSecret("acct", { ...secret, password: "" }, env)
    ).rejects.toMatchObject({ code: "bad_secret" })
    expect(await readAccountSecret("acct", env)).toBeNull()
  })

  test("surfaces a corrupt secret instead of treating it as missing", async () => {
    const env = await tempEnv()
    const dir = env.OTBOR_MAIL_DIR as string
    await writeFile(join(dir, "acct.secret.json"), "{not json")
    await expect(readAccountSecret("acct", env)).rejects.toMatchObject({ code: "bad_secret" })

    await writeFile(join(dir, "acct.secret.json"), JSON.stringify({ host: "x" }))
    await expect(readAccountSecret("acct", env)).rejects.toMatchObject({ code: "bad_secret" })
  })

  test("deletes idempotently", async () => {
    const env = await tempEnv()
    await writeAccountSecret("acct", secret, env)
    await deleteAccountSecret("acct", env)
    expect(await readAccountSecret("acct", env)).toBeNull()
    await deleteAccountSecret("acct", env)
  })
})
