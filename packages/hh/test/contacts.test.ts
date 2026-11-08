import { describe, expect, test } from "bun:test"
import { hasContactsHeading, parseProfileContactList, parseProfileContacts } from "../src/contacts.ts"

const SAMPLE = `Контакты
Телефон
+7 995 260-41-35
Почта
german.vorob@gmail.com
Telegram
@german_vrb`

describe("parseProfileContacts", () => {
  test("полный блок", () => {
    expect(parseProfileContacts(SAMPLE)).toEqual({
      phone: "+79952604135",
      email: "german.vorob@gmail.com",
      telegram: "@german_vrb"
    })
    expect(hasContactsHeading(SAMPLE)).toBe(true)
  })

  test("список содержит исходную строку", () => {
    const list = parseProfileContactList(SAMPLE)
    expect(list.map((item) => item.kind)).toEqual(["phone", "email", "telegram"])
    expect(list[0]?.raw).toBe("+7 995 260-41-35")
  })

  test("часть контактов отсутствует: подпись сразу перед другой подписью", () => {
    const text = "Контакты\nТелефон\nПочта\nGerman@Mail.RU\nTelegram\n"
    expect(parseProfileContacts(text)).toEqual({ phone: null, email: "german@mail.ru", telegram: null })
  })

  test("регистр подписей, Email, Телеграм и t.me-ссылка", () => {
    const text = "КОНТАКТЫ\nтелефон\n8 (995) 260-41-35\nE-mail\nA@B.io\nТелеграм\nhttps://t.me/German_VRB/"
    expect(parseProfileContacts(text)).toEqual({
      phone: "+79952604135",
      email: "a@b.io",
      telegram: "@german_vrb"
    })
  })

  test("голое имя пользователя и лишние подписи с хвостом", () => {
    const text = `Контакты
Предпочитаемый способ связи
Telegram
Сайт
https://example.com
Telegram
german_vrb
Другие контакты
Опыт работы
Телефон`
    expect(parseProfileContacts(text)).toEqual({ phone: null, email: null, telegram: "@german_vrb" })
  })

  test("мусор вместо значений даёт null", () => {
    const text = "Телефон\n123\nПочта\nне почта\nTelegram\n@a"
    expect(parseProfileContacts(text)).toEqual({ phone: null, email: null, telegram: null })
    expect(parseProfileContacts("")).toEqual({ phone: null, email: null, telegram: null })
    expect(hasContactsHeading("Мои контакты тут")).toBe(false)
  })
})
