import { describe, expect, test } from "bun:test"
import type { DecisionRecord } from "@otbor/contract"
import type { ReconRow } from "@/shared/lib"
import { latestApplications, decidedBy, filterRulesText, fitWasComputed, listPreview, parseFilterFailures, descriptionBlocks, isLegacyDecisionsResponse, pickDecision, reasonLine, reconWording, verdictText } from "./lib"

/** `formatNumber` разделяет тысячи неразрывным пробелом: в тестах приводим к обычному. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ")

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
    const filter = reasonLine({ code: "blocked_filter", detail: "salary >= 200000 (RUR)" })
    expect(filter.mark).toBe("no")
    expect(plain(filter.text)).toBe("Зарплата: нужно от 200 000 ₽")
    expect(filter.text).not.toContain("не прошла")
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
  test("обычные правила читаются словами", () => {
    expect(plain(filterRulesText("salary >= 200000 (RUR, or missing)"))).toBe("Зарплата: нужно от 200 000 ₽")
    expect(plain(filterRulesText("salary gte 200000"))).toBe("Зарплата: нужно от 200 000")
    expect(filterRulesText("location in 113, location in 113")).toBe("Место работы вне выбранных")
    expect(filterRulesText("work_format in remote,hybrid")).toBe("Формат работы не из допустимых: удалённо, гибрид")
    expect(filterRulesText("archived is false")).toBe("Вакансия в архиве")
    expect(filterRulesText("applied not_in account:01a19cde-c2a7-79c4-adcd-e92ab3edd592")).toBe("Вы уже откликались в эту компанию")
    expect(filterRulesText("hidden not_in any")).toBe("Вакансия скрыта: в чёрном списке")
    expect(filterRulesText("seniority in middle,senior")).toBe("Уровень не из допустимых: Мидл, Сеньор")
  })

  test("несколько правил идут через запятую сервера и остаются отдельными", () => {
    const failures = parseFilterFailures("title not_contains_any k8s, kubernetes, salary >= 200000, archived is false")
    expect(failures.map((failure) => plain(failure.alternatives[0]![0]!.text))).toEqual([
      "Название содержит стоп-слова",
      "Зарплата: нужно от 200 000",
      "Вакансия в архиве"
    ])
    expect(failures[0]!.alternatives[0]![0]!.items).toEqual(["k8s", "kubernetes"])
  })

  test("незнакомый вид остаётся как есть", () => {
    expect(filterRulesText("что-то своё")).toBe("что-то своё")
    expect(filterRulesText("weird_field contains x")).toBe("weird_field contains x")
    expect(filterRulesText("any of: сломанное ? условие")).toBe("any of: сломанное ? условие")
  })
})

describe("parseFilterFailures: группы «any of»", () => {
  test("обрезанная группа с одним условием читается как правило со списком", () => {
    const [failure] = parseFilterFailures(
      "any of: title contains_any devops,dev ops,dev-ops,devsecops,dev sec ops,sre,platform,k8s,kubernetes,pl…"
    )
    const condition = failure!.alternatives[0]![0]!
    expect(failure!.group).toBe(true)
    expect(failure!.alternatives).toHaveLength(1)
    expect(condition.text).toBe("Название не содержит ни одного из слов")
    // Оборванное «pl» отброшено, список помечен как неполный.
    expect(condition.items).toEqual(["devops", "dev ops", "dev-ops", "devsecops", "dev sec ops", "sre", "platform", "k8s", "kubernetes"])
    expect(condition.cut).toBe(true)
  })

  test("варианты через | и условия через &", () => {
    const [failure] = parseFilterFailures("any of: title contains_any devops,sre | analysis_role in devops,sre & salary >= 100000")
    expect(failure!.alternatives).toHaveLength(2)
    expect(failure!.alternatives[1]!.map((condition) => plain(condition.text))).toEqual([
      "Роль по разбору не из допустимых",
      "Зарплата: нужно от 100 000"
    ])
    expect(failure!.more).toBe(false)
    expect(filterRulesText("any of: title contains_any devops,sre | analysis_role in devops,sre")).toBe(
      "Название не содержит ни одного из слов: devops, sre или Роль по разбору не из допустимых: devops, sre"
    )
  })

  test("оборванный на середине оператора хвост уходит в «и другие»", () => {
    const [failure] = parseFilterFailures("any of: title contains_any devops,sre | analysis_ro…")
    expect(failure!.alternatives).toHaveLength(1)
    expect(failure!.more).toBe(true)
  })

  test("группа и обычные правила в одной детали", () => {
    const failures = parseFilterFailures("any of: title contains_any devops,sre, archived is false")
    expect(failures).toHaveLength(2)
    expect(failures[1]!.alternatives[0]![0]!.text).toBe("Вакансия в архиве")
  })
})

describe("listPreview", () => {
  const many = Array.from({ length: 10 }, (_, index) => `w${index}`)
  test("короткий список показывается целиком", () => {
    expect(listPreview(["a", "b"], false)).toEqual({ shown: ["a", "b"], hidden: 0, other: false, canExpand: false })
    expect(listPreview(many.slice(0, 7), false).shown).toHaveLength(7)
  })
  test("длинный сворачивается и разворачивается", () => {
    const folded = listPreview(many, false)
    expect(folded.shown).toHaveLength(6)
    expect(folded.hidden).toBe(4)
    expect(folded.canExpand).toBe(true)
    expect(listPreview(many, false, true).shown).toHaveLength(10)
  })
  test("обрезанный сервером не разворачивается: «и другие»", () => {
    const cut = listPreview(many, true, true)
    expect(cut).toMatchObject({ hidden: 0, other: true, canExpand: false })
    expect(cut.shown).toHaveLength(6)
  })
})

describe("descriptionBlocks: пункты в одной строке с заголовком", () => {
  test("заголовок с первым значком и продолжение списка через «;»", () => {
    const blocks = descriptionBlocks("Обязанности: • Первое;\nВторое;\nТретье.\n\nТребования:\n- Опыт")
    expect(blocks[0]).toEqual({ kind: "heading", text: "Обязанности" })
    expect(blocks[1]).toEqual({ kind: "list", items: ["Первое;", "Второе;", "Третье."] })
    expect(blocks[2]).toEqual({ kind: "heading", text: "Требования" })
  })
})

describe("fitWasComputed", () => {
  test("соответствие не считалось у пропуска по правилу", () => {
    expect(fitWasComputed({ verdict: "skip", reasons: [{ code: "blocked_filter" }] })).toBe(false)
    expect(fitWasComputed({ verdict: "skip", reasons: [{ code: "blocked_low_fit", detail: "fit 40 < 60" }] })).toBe(true)
    expect(fitWasComputed({ verdict: "apply", reasons: [] })).toBe(true)
  })
})
