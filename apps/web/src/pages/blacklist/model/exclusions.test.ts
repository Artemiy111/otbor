import { describe, expect, test } from "bun:test"
import type { BlacklistRecord } from "@otbor/contract"
import { groupExclusions, hhUrl, internalPath, originLabel, parseHhTarget, removalKind } from "./exclusions"

const record = (patch: Partial<BlacklistRecord>): BlacklistRecord =>
  ({
    id: "1" as never,
    scope: "hh_native",
    hhAccountId: "a",
    resumeId: null,
    targetType: "employer",
    externalId: "100",
    name: "Acme",
    source: "hh_hidden",
    reason: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    lastSeenAt: null,
    ...patch
  }) as BlacklistRecord

describe("groupExclusions", () => {
  test("один работодатель, скрытый двумя аккаунтами, это одна строка", () => {
    const rows = groupExclusions([record({ id: "1" as never, hhAccountId: "a" as never }), record({ id: "2" as never, hhAccountId: "b" as never })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ids).toEqual(["1", "2"])
    expect(rows[0]!.accountIds).toEqual(["a", "b"])
  })

  test("отбраковка для разных резюме остаётся разными строками", () => {
    const rows = groupExclusions([
      record({ id: "1" as never, scope: "resume", targetType: "vacancy", resumeId: "r1" as never }),
      record({ id: "2" as never, scope: "resume", targetType: "vacancy", resumeId: "r2" as never })
    ])
    expect(rows).toHaveLength(2)
  })
})

describe("originLabel", () => {
  test("импорт, ручная запись и кнопка различаются", () => {
    expect(originLabel({ source: "hh_hidden", scope: "hh_native", targetType: "employer" })).toBe("Импорт с hh")
    expect(originLabel({ source: "user", scope: "app", targetType: "employer" })).toBe("Вручную")
    expect(originLabel({ source: "reject", scope: "app", targetType: "vacancy" })).toBe("Кнопка «Отбраковать»")
    expect(originLabel({ source: "reject", scope: "hh_account", targetType: "vacancy" })).toBe("Кнопка «Отбраковать»")
  })

  test("старые строки: слой резюме точно от кнопки, вакансия с user неоднозначна", () => {
    expect(originLabel({ source: "user", scope: "resume", targetType: "vacancy" })).toBe("Кнопка «Отбраковать»")
    expect(originLabel({ source: "user", scope: "app", targetType: "vacancy" })).toBe(
      "Вручную (или отбраковка до обновления)"
    )
  })
})

describe("internalPath", () => {
  test("ведёт на вакансию или компанию в otbor, если они есть в базе", () => {
    expect(internalPath(record({ targetType: "vacancy", vacancyId: "v 1" as never }))).toBe("/vacancies/v%201")
    expect(internalPath(record({ targetType: "employer", employerId: "e1" as never }))).toBe("/companies/e1")
    expect(internalPath(record({ targetType: "vacancy", vacancyId: null }))).toBeNull()
    expect(internalPath(record({ targetType: "employer" }))).toBeNull()
  })
})

describe("removalKind", () => {
  test("вакансии снимаются через отбраковку, кроме скрытых на hh", () => {
    expect(removalKind({ scope: "app", targetType: "vacancy" })).toBe("unreject")
    expect(removalKind({ scope: "hh_native", targetType: "vacancy" })).toBe("remove")
    expect(removalKind({ scope: "app", targetType: "employer" })).toBe("remove")
  })
})

describe("parseHhTarget", () => {
  test("берёт тип и номер из ссылки", () => {
    expect(parseHhTarget("https://hh.ru/employer/1740?hhtmFrom=x")).toEqual({ type: "employer", externalId: "1740" })
    expect(parseHhTarget(" https://spb.hh.ru/vacancy/123456 ")).toEqual({ type: "vacancy", externalId: "123456" })
  })
  test("просто номер остаётся номером", () => {
    expect(parseHhTarget(" 42 ")).toEqual({ type: null, externalId: "42" })
  })
  test("ссылка на цель строится по типу", () => {
    expect(hhUrl("employer", "1")).toBe("https://hh.ru/employer/1")
  })
})
