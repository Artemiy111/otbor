import { describe, expect, test } from "bun:test"
import type { FormQuestion, KitAnswer, StoredHint } from "@otbor/contract"
import {
  answersFromKit,
  buildKitAnswers,
  isKitDirty,
  kitProblems,
  missingParts,
  problemsByQuestion,
  toggleOption
} from "./answers"

const single: FormQuestion = {
  id: "1",
  kind: "single",
  text: "Готовы к офису?",
  options: [
    { id: "a", label: "Да" },
    { id: "b", label: "Нет" }
  ],
  required: true
}
const multiple: FormQuestion = { ...single, id: "2", kind: "multiple", required: false }
const text: FormQuestion = { id: "3", kind: "text", text: "Почему мы?", options: [], required: true }
const questions = [single, multiple, text]

const hint: StoredHint = {
  questionId: "1",
  kind: "office",
  optionIds: ["a"],
  hard: true,
  confidence: 1,
  note: null,
  evidence: [],
  blockers: []
}

const saved: Array<KitAnswer> = [
  { questionId: "3", text: "Нравится продукт", source: "model", hard: false, needsHuman: true }
]

describe("toggleOption", () => {
  test("radio заменяет выбор, checkbox переключает", () => {
    expect(toggleOption(single, { optionIds: ["a"], text: "" }, "b").optionIds).toEqual(["b"])
    expect(toggleOption(multiple, { optionIds: ["a"], text: "" }, "b").optionIds).toEqual(["a", "b"])
    expect(toggleOption(multiple, { optionIds: ["a", "b"], text: "" }, "a").optionIds).toEqual(["b"])
  })
})

describe("answersFromKit", () => {
  test("сохранённое важнее подсказки, пустое берёт подсказку", () => {
    const map = answersFromKit(questions, saved, [hint])
    expect(map["1"]?.optionIds).toEqual(["a"])
    expect(map["3"]?.text).toBe("Нравится продукт")
    expect(map["2"]).toEqual({ optionIds: [], text: "" })
  })

  test("без подсказок остаётся только сохранённое", () => {
    expect(answersFromKit(questions, saved, [hint], false)["1"]?.optionIds).toEqual([])
  })
})

describe("buildKitAnswers", () => {
  test("пустые ответы пропускаются, подсказка помечается hint, правка человека - human", () => {
    const result = buildKitAnswers({
      questions,
      answers: { "1": { optionIds: ["a"], text: "" }, "2": { optionIds: [], text: "" }, "3": { optionIds: [], text: " свой " } },
      hints: [hint]
    })
    expect(result).toEqual([
      { questionId: "1", optionIds: ["a"], source: "hint", hard: true, needsHuman: false },
      { questionId: "3", text: "свой", source: "human", hard: false, needsHuman: false }
    ])
  })

  test("неизменённый сохранённый ответ остаётся как был, правка снимает пометку needsHuman", () => {
    const untouched = buildKitAnswers({
      questions,
      answers: { "3": { optionIds: [], text: "Нравится продукт" } },
      hints: [],
      saved
    })
    expect(untouched).toEqual(saved)
    const edited = buildKitAnswers({
      questions,
      answers: { "3": { optionIds: [], text: "Другое" } },
      hints: [],
      saved
    })
    expect(edited[0]).toMatchObject({ source: "human", needsHuman: false, text: "Другое" })
  })

  test("ответ модели из этой сессии остаётся model, пока его не правили", () => {
    const model = new Map([["3", { optionIds: [], text: "Текст модели" }]])
    const answers = { "3": { optionIds: [], text: "Текст модели" } }
    expect(buildKitAnswers({ questions, answers, hints: [], model })[0]).toMatchObject({ source: "model" })
    expect(buildKitAnswers({ questions, answers: { "3": { optionIds: [], text: "Правка" } }, hints: [], model })[0]).toMatchObject({
      source: "human"
    })
  })
})

describe("isKitDirty", () => {
  const base = { questions, hints: [], saved, savedLetter: "Привет" }
  test("то же самое - не изменено, пробелы вокруг не считаются", () => {
    expect(isKitDirty({ ...base, letter: " Привет ", answers: { "3": { optionIds: [], text: "Нравится продукт " } } })).toBe(false)
  })
  test("ответ на вопрос, которого в форме уже нет, не делает черновик изменённым", () => {
    const stale: Array<KitAnswer> = [...saved, { questionId: "gone", text: "старое", source: "human", hard: false, needsHuman: false }]
    expect(
      isKitDirty({ ...base, saved: stale, letter: "Привет", answers: { "3": { optionIds: [], text: "Нравится продукт" } } })
    ).toBe(false)
  })
  test("письмо или ответ изменились", () => {
    expect(isKitDirty({ ...base, letter: "Здравствуйте", answers: { "3": { optionIds: [], text: "Нравится продукт" } } })).toBe(true)
    expect(isKitDirty({ ...base, letter: "Привет", answers: { "3": { optionIds: [], text: "Нет" } } })).toBe(true)
    expect(
      isKitDirty({ ...base, letter: "Привет", answers: { "3": { optionIds: [], text: "Нравится продукт" }, "1": { optionIds: ["b"], text: "" } } })
    ).toBe(true)
  })
})

describe("missingParts", () => {
  test("называет письмо и обязательные вопросы без ответа", () => {
    expect(
      missingParts({ letter: "", letterRule: "required", questions, answers: { "1": { optionIds: ["a"], text: "" } } })
    ).toEqual(["сопроводительное письмо", "вопрос 3"])
    expect(missingParts({ letter: "", letterRule: "optional", questions: [multiple], answers: {} })).toEqual([])
  })
})

describe("отказ сервера", () => {
  const error = {
    _tag: "AnswersInvalid",
    problems: [
      { code: "required_unanswered", questionId: "1", message: "x" },
      { code: "text_too_long", questionId: "3", message: "y" },
      { code: "form_changed", questionId: "", message: "form changed" },
      { code: "brand_new", questionId: "3", message: "что-то новое" }
    ]
  }

  test("kitProblems читает problems и игнорирует чужие ошибки", () => {
    expect(kitProblems(error)).toHaveLength(4)
    expect(kitProblems(new Error("boom"))).toEqual([])
    expect(kitProblems(null)).toEqual([])
  })

  test("problemsByQuestion группирует по вопросам, по-русски, общие под пустым ключом", () => {
    const map = problemsByQuestion(kitProblems(error))
    expect(map.get("1")).toEqual(["Обязательный вопрос без ответа."])
    expect(map.get("3")).toEqual(["Ответ длиннее, чем разрешает hh.", "что-то новое"])
    expect(map.get("")?.[0]).toContain("Форма на hh изменилась")
  })
})
