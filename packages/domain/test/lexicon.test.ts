import { describe, expect, test } from "bun:test"
import { matchLexicon, matchedTerms } from "../src/lexicon.ts"
import type { LexiconEntryInput } from "../src/lexicon.ts"

const entries: ReadonlyArray<LexiconEntryInput> = [
  {
    id: "k8s-id",
    term: "Kubernetes",
    aliases: [
      { id: "k8s-alias", alias: "k8s" },
      { id: "kuber-alias", alias: "кубернетес" }
    ]
  },
  {
    id: "tf-id",
    term: "Terraform",
    aliases: []
  }
]

describe("matchLexicon", () => {
  test("keeps one row per matched form", () => {
    const matches = matchLexicon(entries, {
      title: "Kubernetes engineer",
      body: "Мы используем k8s и Kubernetes в проде",
      skills: ["Kubernetes"]
    })

    const forms = matches.map((match) => match.matchedForm)
    expect(forms).toContain("kubernetes")
    expect(forms).toContain("k8s")

    const canonical = matches.find((match) => match.matchedForm === "kubernetes")!
    expect(canonical.inTitle).toBe(true)
    expect(canonical.titleCount).toBe(1)
    expect(canonical.bodyCount).toBe(1)
    expect(canonical.inSkills).toBe(true)
    expect(canonical.aliasId).toBeNull()

    const alias = matches.find((match) => match.matchedForm === "k8s")!
    expect(alias.aliasId).toBe("k8s-alias")
    expect(alias.inTitle).toBe(false)
    expect(alias.bodyCount).toBe(1)
  })

  test("does not match inside other words", () => {
    const matches = matchLexicon(entries, {
      title: "Kubernetes",
      body: "KubernetesOperator is not a thing",
      skills: []
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]!.bodyCount).toBe(0)
  })

  test("attributes a typo to the canonical term", () => {
    const matches = matchLexicon(entries, {
      title: "Kubernetis engineer",
      body: "",
      skills: []
    })

    const typo = matches.find((match) => match.typo)
    expect(typo).toBeDefined()
    expect(typo!.matchedForm).toBe("kubernetis")
    expect(typo!.term).toBe("Kubernetes")
  })

  test("matchedTerms deduplicates canonical terms by location", () => {
    const matches = matchLexicon(entries, {
      title: "Kubernetes",
      body: "k8s and terraform",
      skills: []
    })
    expect(matchedTerms(matches, "title")).toEqual(["kubernetes"])
    expect(matchedTerms(matches, "body")).toEqual(["kubernetes", "terraform"])
  })
})
