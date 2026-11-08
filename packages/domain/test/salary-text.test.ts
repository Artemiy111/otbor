import { describe, expect, test } from "bun:test"
import { detectSalaryInText } from "../src/salary-text.ts"

const d = (t: string | null) => detectSalaryInText(t)

describe("detectSalaryInText", () => {
  test("оклад без валюты до вычета налога", () => {
    expect(d("Оклад 250000р до вычета налога")).toMatchObject({ from: 250000, to: 250000, currency: "RUB", gross: true })
  })
  test("оплата с тире и налогами", () => {
    expect(d("• Оплата – 90 000 до вычета налогов")).toMatchObject({ from: 90000, gross: true })
  })
  test("до N на руки", () => {
    expect(d("Зарплата до 150 000 ₽ на руки;")).toMatchObject({ from: null, to: 150000, gross: false })
  })
  test("вилка", () => {
    expect(d("Зарплата 200–300 тыс. руб. gross")).toMatchObject({ from: 200000, to: 300000, gross: true })
    expect(d("Вилка: от 180 000 до 250 000 руб на руки")).toMatchObject({ from: 180000, to: 250000, gross: false })
  })
  test("валюта", () => {
    expect(d("— зарплата от 2 000 $")).toMatchObject({ from: 2000, to: null, currency: "USD" })
  })
  test("к-суффикс", () => {
    expect(d("ЗП 300к net")).toMatchObject({ from: 300000, gross: false })
  })
  test("оклад — N руб", () => {
    expect(d("Оклад — 70 000 руб")).toMatchObject({ from: 70000, currency: "RUB", gross: null })
  })
  test("не зарплата", () => {
    expect(d("Оплата за один урок со скринкастом 5000 ₽ gross")).toBeNull()
    expect(d("компенсируем до 3450 рублей gross от стоимости заказа")).toBeNull()
    expect(d("ежегодный пересмотр зарплаты, годовая премия")).toBeNull()
    expect(d("Сегодня у нас 40 000 заказов в сутки и 1 млрд рублей в заказах")).toBeNull()
    expect(d("Выплату заработной платы 2 раза в месяц без задержек - 433 руб")).toBeNull()
    expect(d(null)).toBeNull()
  })
})

describe("detectSalaryInText: headcount and certificates", () => {
  test("not money", () => {
    expect(detectSalaryInText("Работа в крупной компании (69 тыс. сотрудников), оплата вовремя")).toBeNull()
    expect(detectSalaryInText("Сертификаты ISO 27001, опыт с .NET")).toBeNull()
  })
})
