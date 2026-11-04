import { describe, expect, test } from "bun:test"
import {
  detectApplicationRequests,
  detectCoverLetter,
  detectRedFlags,
  detectVacancyConditions,
  detectVacancyTextFacts
} from "../src/vacancy-facts.ts"

const codes = (text: string) => detectRedFlags(text).map((flag) => flag.code)

describe("detectCoverLetter", () => {
  test("requested", () => {
    const r = detectCoverLetter("Сопроводительное письмо обязательно.")
    expect(r.requested).toBe(true)
    expect(r.evidence).toBe("Сопроводительное письмо обязательно.")
  })
  test("negated", () => {
    expect(detectCoverLetter("Сопроводительное письмо необязательно.")).toEqual({
      requested: false,
      evidence: null
    })
  })
  test("empty", () => {
    expect(detectCoverLetter(null).requested).toBe(false)
  })
})

describe("detectApplicationRequests", () => {
  test("list under an attach heading", () => {
    const found = detectApplicationRequests("К отклику приложите:\n- ссылку на GitHub\n- портфолио\n\nТребования\nGitHub Actions")
    expect(found.map((r) => r.code)).toEqual(["github", "portfolio"])
  })
})

describe("detectVacancyConditions", () => {
  test("probation months and unpaid", () => {
    const c = detectVacancyConditions("Испытательный срок 3 месяца, не оплачивается.")
    expect(c?.probation).toBe(true)
    expect(c?.probationMonths).toBe(3)
    expect(c?.probationPaid).toBe(false)
    expect(codes("Испытательный срок 3 месяца, не оплачивается.")).toContain("probation_unpaid")
  })
  test("overtime none, possible, paid", () => {
    expect(detectVacancyConditions("Без переработок.")?.overtime).toBe("none")
    expect(detectVacancyConditions("Возможны переработки.")?.overtime).toBe("possible")
    expect(detectVacancyConditions("Переработки оплачиваются.")?.overtime).toBe("paid")
    expect(codes("Без переработок.")).not.toContain("overtime")
    expect(codes("Переработки оплачиваются.")).not.toContain("overtime")
    expect(codes("Возможны переработки.")).toContain("overtime")
  })
  test("business trips percent", () => {
    const c = detectVacancyConditions("Командировки до 30%.")
    expect(c?.businessTrips).toBe("percent")
    expect(c?.businessTripsPercent).toBe(30)
  })
  test("english level", () => {
    const c = detectVacancyConditions("Английский B2 для чтения документации.")
    expect(c?.englishLevel).toBe("B2")
    expect(c?.englishRequired).toBe(true)
  })
  test("unpaid test task is also a red flag", () => {
    const text = "Тестовое задание не оплачивается."
    expect(detectVacancyConditions(text)?.testTask).toBe("unpaid")
    expect(codes(text)).toContain("unpaid_test")
  })
  test("interview stages vs duration", () => {
    expect(detectVacancyConditions("У нас 3 этапа собеседования.")?.interviewStages).toBe(3)
    expect(detectVacancyConditions("Интервью 1 час.")?.interviewStages ?? null).toBeNull()
  })
  test("official employment vs cash", () => {
    expect(detectVacancyConditions("Оформление по ТК РФ.")?.officialEmployment).toBe(true)
    const text = "Зарплата в конверте."
    expect(detectVacancyConditions(text)?.officialEmployment).toBe(false)
    expect(codes(text)).toContain("salary_in_cash")
  })
})

describe("job_scam", () => {
  test("flags a fee", () => {
    expect(codes("Вступительный взнос 5000 рублей.")).toContain("job_scam")
  })
  test("exception cancels", () => {
    expect(codes("Вступительный взнос не за счёт кандидата.")).not.toContain("job_scam")
  })
})

describe("detectVacancyTextFacts", () => {
  test("nothing found", () => {
    const facts = detectVacancyTextFacts("Мы делаем софт. Приходите.")
    expect(facts.conditions).toBeNull()
    expect(facts.redFlags).toEqual([])
    expect(facts.applicationRequests).toEqual([])
    expect(facts.coverLetter.requested).toBe(false)
  })
  test("null input", () => {
    expect(detectVacancyTextFacts(undefined).conditions).toBeNull()
  })
  test("red flags are top-level, in order", () => {
    const facts = detectVacancyTextFacts("Зарплата в конверте. Тестовое задание не оплачивается.")
    expect(facts.redFlags.map((f) => f.code)).toEqual(["salary_in_cash", "unpaid_test"])
  })
})
