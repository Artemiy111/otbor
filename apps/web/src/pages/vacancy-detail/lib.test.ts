import { describe, expect, test } from "bun:test"
import type { DecisionRecord } from "@otbor/contract"
import type { ReconRow } from "@/shared/lib"
import { latestApplications, decidedBy, filterRulesText, fitWasComputed, descriptionBlocks, isLegacyDecisionsResponse, pickDecision, reasonLine, reconWording, verdictText } from "./lib"

const NOW = new Date("2026-11-10T12:00:00Z")

describe("reasonLine", () => {
  test("совпавшие навыки читаются фразой", () => {
    expect(reasonLine({ code: "skill_match", detail: "title: Kubernetes, Terraform" })).toEqual({
      mark: "ok",
      text: "совпали навыки в заголовке: Kubernetes, Terraform"
    })
    expect(reasonLine({ code: "skill_match", detail: "body: Go" }).text).toBe("совпали навыки в тексте: Go")
  })

  test("правило фильтра и порог соответствия", () => {
    expect(reasonLine({ code: "blocked_filter", detail: "зарплата от 200 000" })).toEqual({
      mark: "no",
      text: "не прошла правило фильтра: зарплата от 200 000"
    })
    expect(reasonLine({ code: "blocked_low_fit", detail: "fit 40 < 60" }).text).toBe(
      "соответствие 40 ниже порога 60"
    )
  })

  test("свежесть считается от «сейчас»", () => {
    expect(reasonLine({ code: "freshness", detail: "2026-11-07T12:00:00Z" }, NOW).text).toBe("опубликована 3 дн. назад")
    expect(reasonLine({ code: "freshness" }, NOW).text).toBe("дата публикации неизвестна")
  })

  test("кто поставил оценку", () => {
    const rules = { reasons: [{ code: "fit" as const, detail: "deterministic 78" }] }
    const model = { reasons: [{ code: "fit" as const, detail: "llm 80" }] }
    expect(decidedBy(rules)).toBe("rules")
    expect(decidedBy(model)).toBe("model")
  })

  test("вердикт пропуска называет причину", () => {
    expect(
      verdictText({ verdict: "skip", reasons: [{ code: "blocked_applied", detail: "already applied" }] })
    ).toBe("Пропущена: вы уже откликались с этим резюме")
    expect(verdictText({ verdict: "apply", reasons: [] })).toBe("Подходит: можно откликаться")
  })
})

const decision = (over: Partial<DecisionRecord>): DecisionRecord =>
  ({
    id: "d",
    userId: "u",
    vacancyId: "v",
    verdict: "apply",
    fit: 70,
    priority: 1,
    reasons: [],
    policyVersion: 1,
    createdAt: "2026-11-01T00:00:00Z",
    ...over
  }) as unknown as DecisionRecord

describe("pickDecision", () => {
  test("точное резюме важнее аккаунта, аккаунт важнее чужого", () => {
    const list = [
      decision({ policyVersion: 1, id: "a" as never, hhAccountId: "acc1" as never, resumeId: "r1" as never }),
      decision({ id: "b" as never, hhAccountId: "acc1" as never, resumeId: null }),
      decision({ id: "c" as never, hhAccountId: "acc2" as never, resumeId: "r9" as never })
    ]
    expect(String(pickDecision(list, "acc1", "r1")?.id)).toBe("a")
    expect(String(pickDecision(list, "acc1", "r2")?.id)).toBe("b")
    expect(pickDecision(list, "acc3", "r1")).toBeNull()
  })
})

describe("isLegacyDecisionsResponse", () => {
  test("чужая вакансия в ответе выдаёт старый сервер", () => {
    expect(isLegacyDecisionsResponse([{ vacancyId: "v1" as never }, { vacancyId: "v2" as never }], "v1")).toBe(true)
  })
  test("только своя вакансия и пустой ответ - новый сервер", () => {
    expect(isLegacyDecisionsResponse([{ vacancyId: "v1" as never }], "v1")).toBe(false)
    expect(isLegacyDecisionsResponse([], "v1")).toBe(false)
  })
})

const cell = (norm: string | null, text: string | null) => ({ norm, text })

describe("reconWording", () => {
  test("расхождение называется словами", () => {
    const row: ReconRow = {
      key: "format",
      group: "profile",
      label: "Формат",
      cells: { hh: cell("remote", "удалённо"), text: cell("hybrid", "гибрид"), ai: cell("hybrid", "гибрид") },
      conflict: true,
      answered: 3,
      summary: ""
    }
    expect(reconWording(row)).toEqual({
      label: "Формат",
      sources: "hh: удалённо · текст: гибрид · ИИ: гибрид",
      verdict: "conflict",
      note: "расхождение"
    })
  })

  test("молчащий источник не попадает в строку", () => {
    const row: ReconRow = {
      key: "x",
      group: "risk",
      label: "Овертайм",
      cells: { hh: cell(null, null), text: cell("да", "упомянуто"), ai: cell(null, null) },
      conflict: false,
      answered: 1,
      summary: ""
    }
    const wording = reconWording(row)
    expect(wording.sources).toBe("текст: упомянуто")
    expect(wording.verdict).toBe("single")
  })
})

describe("descriptionBlocks", () => {
  test("заголовок, список и абзац", () => {
    const blocks = descriptionBlocks("Мы ищем инженера.\nРаботаем быстро.\n\nТребования:\n- Go\n- Kubernetes\n\nУсловия:\n• ДМС")
    expect(blocks).toEqual([
      { kind: "paragraph", text: "Мы ищем инженера. Работаем быстро." },
      { kind: "heading", text: "Требования" },
      { kind: "list", items: ["Go", "Kubernetes"] },
      { kind: "heading", text: "Условия" },
      { kind: "list", items: ["ДМС"] }
    ])
  })
})

describe("latestApplications", () => {
  test("по одному отклику на пару аккаунт+резюме, новые выше", () => {
    const list = [
      { id: "1", hhAccountId: "a", resumeId: "r1", updatedAt: "2026-11-01" },
      { id: "2", hhAccountId: "a", resumeId: "r1", updatedAt: "2026-11-03" },
      { id: "3", hhAccountId: "a", resumeId: "r2", updatedAt: "2026-11-05" }
    ]
    expect(latestApplications(list).map((item) => item.id)).toEqual(["3", "2"])
  })
})

describe("filterRulesText", () => {
  test("правила фильтра читаются словами", () => {
    expect(filterRulesText("salary gte 200000")).toBe("зарплата: от 200000")
    expect(filterRulesText("location in 113, location in 113")).toBe("место работы")
    expect(filterRulesText("work_format in REMOTE, HYBRID")).toBe("формат работы: из списка REMOTE, HYBRID")
    expect(filterRulesText("что-то своё")).toBe("что-то своё")
  })

  test("соответствие не считалось у пропуска по правилу", () => {
    expect(fitWasComputed({ verdict: "skip", reasons: [{ code: "blocked_filter" }] })).toBe(false)
    expect(fitWasComputed({ verdict: "skip", reasons: [{ code: "blocked_low_fit", detail: "fit 40 < 60" }] })).toBe(true)
    expect(fitWasComputed({ verdict: "apply", reasons: [] })).toBe(true)
  })
})
