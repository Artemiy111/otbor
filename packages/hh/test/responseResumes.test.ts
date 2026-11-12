import { describe, expect, test } from "bun:test"
import { isOnlyOfferedResume, parseResponseResumes, responseResumeHash } from "../src/index.ts"

/** Синтетика по форме реальной страницы отклика (id, хэши и названия выдуманы). */
const A = "aaaa00000000000000000000000000000000aa01"
const B = "bbbb00000000000000000000000000000000bb02"

const page = (state: unknown) =>
  `<html><template style="display:none" id="HH-Lux-InitialState">${JSON.stringify(state)}</template></html>`

const popup = {
  vacancyResponsePopup: {
    vacancy: {
      usedResumeIds: [],
      unusedResumeIds: ["1001", "1002"],
      hiddenResumeIds: ["1002"],
      resumes: {
        "1001": { hash: A, id: "1001", title: [{ string: "Системный администратор" }], _attributes: { hash: A } },
        "1002": { hash: B, id: "1002", title: [{ string: "DevOps-инженер" }] }
      },
      resumeVisibility: {
        "1001": { hash: A, accessType: "clients", id: 1001 },
        "1002": { hash: B, accessType: "clients", id: 1002 }
      }
    }
  }
}

describe("parseResponseResumes", () => {
  test("карта id -> хэш, название и списки", () => {
    const parsed = parseResponseResumes(page(popup))
    expect(parsed.resumes).toEqual([
      { id: "1001", hash: A, title: "Системный администратор" },
      { id: "1002", hash: B, title: "DevOps-инженер" }
    ])
    expect(parsed.usedIds).toEqual([])
    expect(parsed.unusedIds).toEqual(["1001", "1002"])
    expect(parsed.hiddenIds).toEqual(["1002"])
  })

  test("хэш берётся и из одного resumeVisibility, id может быть числом", () => {
    const html = page({ x: { resumeVisibility: { "7": { hash: A, id: 7 } } } })
    expect(responseResumeHash(html, "7")).toBe(A)
    expect(parseResponseResumes(html).usedIds).toBeNull()
  })

  test("нет резюме или нет состояния -> пусто, неизвестный id -> null", () => {
    expect(parseResponseResumes("<html></html>").resumes).toEqual([])
    expect(responseResumeHash(page(popup), "9999")).toBeNull()
  })
})

describe("isOnlyOfferedResume", () => {
  const vacancy = (unused: ReadonlyArray<string> | undefined, ids: ReadonlyArray<string>) =>
    page({
      vacancyResponsePopup: {
        vacancy: {
          ...(unused === undefined ? {} : { usedResumeIds: [], unusedResumeIds: unused }),
          resumes: Object.fromEntries(ids.map((id, index) => [id, { hash: index === 0 ? A : B, id }]))
        }
      }
    })

  test("единственное резюме аккаунта", () => {
    expect(isOnlyOfferedResume(vacancy(["1001"], ["1001"]), "1001")).toBe(true)
  })
  test("вторым резюме на вакансию уже откликались: осталось одно", () => {
    expect(isOnlyOfferedResume(vacancy(["1001"], ["1001", "1002"]), "1001")).toBe(true)
    expect(isOnlyOfferedResume(vacancy(["1001"], ["1001", "1002"]), "1002")).toBe(false)
  })
  test("два кандидата, даже если один скрыт: выбор нужен", () => {
    expect(isOnlyOfferedResume(page(popup), "1001")).toBe(false)
    expect(isOnlyOfferedResume(vacancy(["1001", "1002"], ["1001", "1002"]), "1001")).toBe(false)
  })
  test("без списка считаются все резюме страницы; без состояния - false", () => {
    expect(isOnlyOfferedResume(vacancy(undefined, ["1001"]), "1001")).toBe(true)
    expect(isOnlyOfferedResume(vacancy(undefined, ["1001", "1002"]), "1001")).toBe(false)
    expect(isOnlyOfferedResume("<html></html>", "1001")).toBe(false)
    expect(isOnlyOfferedResume(vacancy([], ["1001"]), "1001")).toBe(false)
  })
})
