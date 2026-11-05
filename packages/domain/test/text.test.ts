import { describe, expect, test } from "bun:test"
import {
  countMatches,
  findTypos,
  normalizeTerm,
  termPattern
} from "../src/text.ts"

describe("normalizeTerm", () => {
  test("lowercases, folds ё and trims punctuation", () => {
    expect(normalizeTerm("  «Kubernetes» ")).toBe("kubernetes")
    expect(normalizeTerm("Ёмкость")).toBe("емкость")
    expect(normalizeTerm("CI/CD")).toBe("ci/cd")
  })
})

describe("termPattern", () => {
  test("matches with unicode word boundaries", () => {
    const pattern = termPattern("Go")
    expect(pattern.test("Мы пишем на Go.")).toBe(true)
    pattern.lastIndex = 0
    expect(pattern.test("Google")).toBe(false)
    pattern.lastIndex = 0
    expect(pattern.test("Django")).toBe(false)
  })

  test("is case-insensitive and folds ё", () => {
    const pattern = termPattern("Надежность")
    expect(countMatches("надёжность и надежность", pattern)).toBe(2)
  })

  test("counts multiple occurrences", () => {
    expect(countMatches("k8s, k8s и ещё k8s", termPattern("k8s"))).toBe(3)
  })
})

describe("findTypos", () => {
  test("finds a one-edit Latin spelling of a long term", () => {
    expect(findTypos("Требуется Kubernetis и Linux", "Kubernetes")).toEqual(["kubernetis"])
  })

  test("does not invent typos for short terms", () => {
    expect(findTypos("Docker and doctor", "Docker")).toEqual([])
  })

  test("ignores tokens with a different first letter", () => {
    expect(findTypos("We used Aubernetis", "Kubernetes")).toEqual([])
  })
})
