import { describe, expect, test } from "bun:test"
import {
  extractContactsFromText,
  extractVacancyIds,
  isBotUsername,
  normalizePhone
} from "../src/contacts.ts"

describe("phone normalization", () => {
  test("Russian and international forms become E.164", () => {
    expect(normalizePhone("+7 (999) 123-45-67")).toBe("+79991234567")
    expect(normalizePhone("8 999 123 45 67")).toBe("+79991234567")
    expect(normalizePhone("9991234567")).toBe("+79991234567")
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  test("numbers that are not phones stay out", () => {
    expect(normalizePhone("2026")).toBeNull()
    expect(normalizePhone("1234567890123456")).toBeNull()
    expect(normalizePhone("1234567890")).toBeNull()
  })
})

describe("extractContactsFromText", () => {
  test("finds e-mail, phone and Telegram with evidence", () => {
    const text = [
      "Здравствуйте! Пишите на ivan.petrov@acme.dev",
      "или в Telegram: @hr_anna",
      "Телефон: +7 (999) 123-45-67"
    ].join("\n")

    const { contacts } = extractContactsFromText(text)

    expect(contacts.map((contact) => `${contact.kind}:${contact.value}`)).toEqual([
      "email:ivan.petrov@acme.dev",
      "phone:+79991234567",
      "telegram:@hr_anna"
    ])
    expect(contacts[0]?.url).toBe("mailto:ivan.petrov@acme.dev")
    expect(contacts[0]?.evidence).toContain("ivan.petrov@acme.dev")
    expect(contacts[1]?.url).toBe("tel:+79991234567")
    expect(contacts[2]?.url).toBe("https://t.me/hr_anna")
  })

  test("a bare handle needs Telegram context", () => {
    expect(extractContactsFromText("спросите @hr_anna").contacts).toEqual([])
    expect(
      extractContactsFromText("@hr_anna", { channel: "telegram" }).contacts[0]?.kind
    ).toBe("telegram")
  })

  test("t.me links and invites are contacts", () => {
    const { contacts } = extractContactsFromText(
      "Мы в телеграме: https://t.me/acme_hr и инвайт t.me/+AbCdEf123"
    )
    const values = contacts.map((contact) => contact.value)
    expect(values).toContain("@acme_hr")
    expect(values).toContain("https://t.me/+AbCdEf123")
  })

  test("bots never keep a human name or role", () => {
    const { contacts } = extractContactsFromText(
      "Меня зовут Анна, HR. Телеграм-бот: @giga_recruiter_bot"
    )
    const bot = contacts.find((contact) => contact.value === "@giga_recruiter_bot")
    expect(bot?.isBot).toBe(true)
    expect(bot?.personName).toBeNull()
    expect(bot?.personRole).toBeNull()
    expect(isBotUsername("Giga_recruiter_bot")).toBe(true)
  })

  test("duplicates collapse by normalized value", () => {
    const { contacts } = extractContactsFromText(
      "HR@Acme.dev and hr@acme.dev; telegram @HR_Anna and https://t.me/hr_anna"
    )
    expect(contacts.filter((contact) => contact.kind === "email")).toHaveLength(1)
    expect(contacts.filter((contact) => contact.kind === "telegram")).toHaveLength(1)
  })

  test("salary ranges are not phone numbers", () => {
    const { contacts } = extractContactsFromText(
      "— Зарплата 70 000–100 000 ₽ на руки в месяц.\nТелефон: +7 (999) 123-45-67"
    )
    expect(contacts.filter((contact) => contact.kind === "phone")).toHaveLength(1)
    expect(contacts.find((contact) => contact.kind === "phone")?.value).toBe("+79991234567")
  })

  test("images and filenames are not e-mail addresses", () => {
    expect(extractContactsFromText("см. logo@2x.png и hero@3x.webp").contacts).toEqual([])
  })

  test("empty text never invents a contact", () => {
    expect(extractContactsFromText("   ")).toEqual({ contacts: [], vacancyIds: [] })
  })
})

describe("hh references", () => {
  test("vacancy links and ids are deduplicated", () => {
    const text =
      "Вакансия https://hh.ru/vacancy/12345678?query=1 и снова hh:12345678, а также vacancy №87654321"
    expect(extractVacancyIds(text)).toEqual(["12345678", "87654321"])
  })

  test("an hh chat link is a contact, not a vacancy", () => {
    const { contacts, vacancyIds } = extractContactsFromText(
      "Пишите в чат https://hh.ru/chat/abcdef"
    )
    expect(vacancyIds).toEqual([])
    expect(contacts).toEqual([
      expect.objectContaining({
        kind: "hh_chat",
        value: "https://hh.ru/chat/abcdef"
      })
    ])
  })
})
