import { describe, expect, test } from "bun:test"
import type { ResumeEnrichment } from "@otbor/contract"
import {
  buildSavePayload,
  draftFromEnrichment,
  isSectionDirty,
  revertSection,
  type ExperienceItem
} from "./enrichment-draft"

const items: ExperienceItem[] = [{ key: "acme dev", matches: (stored) => stored === "acme" }]

const data = {
  resumeId: "r",
  comment: "заметка",
  salaries: [{ currency: "RUB", min: 100, expectation: 200 }],
  faq: [{ key: "english_level", answer: "B2" }, { key: "custom:7", question: "Q", answer: "A" }],
  experience: [{ key: "acme", employmentType: null, comment: "старая заметка", leaveReason: null }],
  currentlyEmployed: null
} as unknown as ResumeEnrichment

const saved = draftFromEnrichment(data, items)

describe("draftFromEnrichment", () => {
  test("заметка со старым коротким ключом показывается у места работы без правки", () => {
    expect(saved.jobNotes["acme dev"]).toBe("старая заметка")
    expect(isSectionDirty("notes", saved, saved, items)).toBe(false)
  })
})

describe("isSectionDirty", () => {
  test("правка одного раздела не помечает другие", () => {
    const draft = { ...saved, salaries: { ...saved.salaries, RUB: { min: "150", expectation: "200" } } }
    expect(isSectionDirty("salary", draft, saved, items)).toBe(true)
    expect(isSectionDirty("notes", draft, saved, items)).toBe(false)
    expect(isSectionDirty("faq", draft, saved, items)).toBe(false)
  })

  test("пробелы в конце и номера своих вопросов правкой не считаются", () => {
    const draft = { ...saved, comment: "заметка  ", customFaq: saved.customFaq.map((e) => ({ ...e, id: e.id + 100 })) }
    expect(isSectionDirty("notes", draft, saved, items)).toBe(false)
    expect(isSectionDirty("faq", draft, saved, items)).toBe(false)
  })
})

describe("buildSavePayload", () => {
  test("сохранение зарплаты не записывает черновик заметок", () => {
    const draft = { ...saved, comment: "новое", salaries: { ...saved.salaries, RUB: { min: "150", expectation: "" } } }
    const payload = buildSavePayload("salary", draft, data, items)
    expect(payload.comment).toBe("заметка")
    expect(payload.salaries).toEqual([{ currency: "RUB", min: 150, expectation: null }])
  })

  test("сохранение заметок оставляет заметки о местах, которых нет в резюме", () => {
    const extra = { ...data, experience: [...data.experience, { key: "gone", employmentType: null, comment: "x", leaveReason: null }] } as ResumeEnrichment
    const payload = buildSavePayload("notes", { ...saved, jobNotes: { "acme dev": "новая" } }, extra, items)
    expect(payload.experience?.map((e) => [e.key, e.comment])).toEqual([["gone", "x"], ["acme dev", "новая"]])
  })

  test("пустой ответ на вопрос в сохранение не попадает", () => {
    const draft = { ...saved, faqAnswers: { english_level: "  " } }
    expect(buildSavePayload("faq", draft, data, items).faq?.map((e) => e.key)).toEqual(["custom:" + draft.customFaq[0]!.id])
  })
})

describe("revertSection", () => {
  test("откатывает только свой раздел", () => {
    const draft = { ...saved, comment: "правка", salaries: { ...saved.salaries, RUB: { min: "1", expectation: "1" } } }
    const next = revertSection("notes", draft, saved)
    expect(next.comment).toBe("заметка")
    expect(next.salaries.RUB.min).toBe("1")
  })
})
