import { describe, expect, test } from "bun:test"
import { detectSeniority } from "../src/seniority.ts"

describe("detectSeniority", () => {
  test("determines the grade from the title", () => {
    expect(detectSeniority("Junior DevOps")).toBe("junior")
    expect(detectSeniority("Middle SRE")).toBe("middle")
    expect(detectSeniority("Middle+ Platform Engineer")).toBe("middle")
    expect(detectSeniority("Senior Platform Engineer")).toBe("senior")
  })

  test("keeps intern separate from junior", () => {
    expect(detectSeniority("Backend Developer Intern")).toBe("intern")
    expect(detectSeniority("iOS Trainee")).toBe("intern")
    expect(detectSeniority("Стажёр-тестировщик (Python)")).toBe("intern")
    expect(detectSeniority("Системный администратор 1С (стажер)")).toBe("intern")
    expect(detectSeniority("DevOps инженер (ученик)")).toBe("intern")
    expect(detectSeniority("Помощник системного администратора")).toBe("intern")
    expect(detectSeniority("Младший системный администратор")).toBe("junior")
    expect(detectSeniority("Начинающий специалист")).toBe("junior")
    // Раньше «руководитель» из описания перебивал стажёра.
    expect(detectSeniority("Стажёр автотестировщик (Java)", "Работа под руководством тимлида")).toBe("intern")
  })

  test("recognizes support-tier and combined titles as junior", () => {
    expect(detectSeniority("Специалист технической поддержки (1-я линия)")).toBe("junior")
    expect(detectSeniority("Системный администратор (1 уровень)")).toBe("junior")
    expect(detectSeniority("Cпециалист технической поддержки (L1)")).toBe("junior")
    expect(detectSeniority("Младший веб-разработчик (стажер)")).toBe("intern")
  })

  test("splits leads into team, technical and head", () => {
    expect(detectSeniority("Senior Team Lead")).toBe("team_lead")
    expect(detectSeniority("Тимлид Data Science/ML")).toBe("team_lead")
    expect(detectSeniority("TeamLead DevOps")).toBe("team_lead")
    expect(detectSeniority("Руководитель группы разработки")).toBe("team_lead")
    expect(detectSeniority("Руководитель команды (C++)")).toBe("team_lead")
    expect(detectSeniority("Golang Tech Lead")).toBe("tech_lead")
    expect(detectSeniority("Технический лидер команды")).toBe("tech_lead")
    expect(detectSeniority("Lead DevOps-инженер")).toBe("tech_lead")
    expect(detectSeniority("Руководитель DevOps")).toBe("head")
    expect(detectSeniority("Начальник отдела информационной безопасности")).toBe("head")
    expect(detectSeniority("Технический директор / Head of IT & AI")).toBe("head")
  })

  test("uses the most specific role when a title has several grades", () => {
    expect(detectSeniority("Senior DevOps / TeamLead")).toBe("team_lead")
    expect(detectSeniority("Senior / Tech Lead / Full-Stack")).toBe("tech_lead")
    expect(detectSeniority("Ведущий эксперт (системный аналитик)")).toBe("staff")
    expect(detectSeniority("Ведущий разработчик 1С")).toBe("senior")
  })

  test("recognizes staff-level titles", () => {
    expect(detectSeniority("Principal Full-Stack AI")).toBe("staff")
    expect(detectSeniority("Staff Software Engineer")).toBe("staff")
    expect(detectSeniority("Системный архитектор")).toBe("staff")
    expect(detectSeniority("Главный системный аналитик")).toBe("staff")
  })

  test("the title is the primary signal: the body does not override it", () => {
    // В описании «старший» и «lead time» часто не про грейд.
    expect(detectSeniority("Middle Frontend разработчик", "Работаем со старшими коллегами")).toBe("middle")
    expect(detectSeniority("Junior DevOps engineer", "Команда senior-инженеров")).toBe("junior")
    expect(detectSeniority("Intern DevOps", "Ищем lead-инженера в команду")).toBe("intern")
  })

  test("falls back to explicit markers in the body", () => {
    expect(detectSeniority("DevOps инженер", "Опыт от 6 лет, senior-уровень")).toBe("senior")
    expect(detectSeniority("DevOps инженер", "Ищем middle инженера")).toBe("middle")
    expect(detectSeniority("DevOps инженер", "Стажировка, junior-уровень")).toBe("junior")
    expect(detectSeniority("DevOps инженер", "Ищем team lead в команду")).toBe("team_lead")
  })

  test("ignores ambiguous or non-grade words in the body", () => {
    expect(detectSeniority("DevOps инженер", "Снижаем lead time и внедряем ведущие практики")).toBe("unknown")
    expect(detectSeniority("DevOps инженер", "Подчиняется руководителю проекта")).toBe("unknown")
    expect(detectSeniority("Бухгалтер", "Работа в команде под руководством руководителя отдела")).toBe("unknown")
    // Несколько разных грейдов в тексте — однозначного сигнала нет.
    expect(detectSeniority("DevOps инженер", "Ищем junior и senior инженеров")).toBe("unknown")
  })

  test("returns unknown without a marker", () => {
    expect(detectSeniority("DevOps инженер")).toBe("unknown")
    expect(detectSeniority("Системный администратор")).toBe("unknown")
  })
})
