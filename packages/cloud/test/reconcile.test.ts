import type { HarnessExit } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { judgeReconcile, reconcileArtifacts } from "../src/services/applyRules.ts"

/** Synthetic hand-written fixtures from packages/hh; see negotiations.test.ts there. */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../hh/test/fixtures", name), "utf8")

const ID = "100500"
const VACANCY_URL = `https://hh.ru/vacancy/${ID}`

const open = fixture("synthetic-vacancy-open.html")
const responded = fixture("synthetic-vacancy-responded.html")
const listWith = fixture("synthetic-negotiations.html")
const listEmpty = fixture("synthetic-negotiations-empty.html")
const listOther = `<template id="HH-Lux-InitialState">{"applicantNegotiations":{"topicList":[{"vacancyId":777,"lastState":"RESPONSE"}]}}</template>`

const page = (html: string, url = "https://hh.ru/applicant/negotiations?page=0") => ({ url, html })

const exit = (
  evidence: {
    vacancy?: ReturnType<typeof page>
    negotiations?: ReadonlyArray<ReturnType<typeof page>>
    externalId?: string
  },
  tag: HarnessExit["tag"] = "reconciled"
): HarnessExit => ({ tag, artifacts: { externalId: ID, ...evidence } })

describe("judgeReconcile", () => {
  test("the vacancy page showing a response settles submitted", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page(responded, VACANCY_URL), negotiations: [page(listWith), page(listEmpty)] }),
      ID
    )
    expect(verdict._tag).toBe("submitted")
  })

  test("the vacancy page alone is enough when the list was not read to the end", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page(responded, VACANCY_URL), negotiations: [page(listOther)] }),
      ID
    )
    expect(verdict._tag).toBe("submitted")
  })

  test("the negotiations list holding the vacancy settles submitted even if the vacancy page is unreadable", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page("<html>oops</html>", VACANCY_URL), negotiations: [page(listWith)] }),
      ID
    )
    expect(verdict._tag).toBe("submitted")
  })

  test("both clearly negative is unsent", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page(open, VACANCY_URL), negotiations: [page(listOther), page(listEmpty)] }),
      ID
    )
    expect(verdict._tag).toBe("unsent")
    if (verdict._tag === "unsent") {
      expect(verdict.reading.vacancy.state).toBe("not_responded")
      expect(verdict.reading.negotiations.exhausted).toBe(true)
    }
  })

  test("a list that was not read to the end is never negative", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page(open, VACANCY_URL), negotiations: [page(listOther)] }),
      ID
    )
    expect(verdict._tag).toBe("retry")
  })

  test("an unreadable vacancy page or list is never negative", () => {
    expect(
      judgeReconcile(exit({ negotiations: [page(listEmpty)] }), ID)._tag
    ).toBe("retry")
    expect(
      judgeReconcile(
        exit({ vacancy: page("<html>archived</html>", VACANCY_URL), negotiations: [page(listEmpty)] }),
        ID
      )._tag
    ).toBe("retry")
    expect(
      judgeReconcile(exit({ vacancy: page(open, VACANCY_URL), negotiations: [page("<html></html>")] }), ID)._tag
    ).toBe("retry")
    expect(judgeReconcile(exit({ vacancy: page(open, VACANCY_URL), negotiations: [] }), ID)._tag).toBe("retry")
    // The vacancy page redirected elsewhere: it says nothing about this vacancy.
    expect(
      judgeReconcile(
        exit({ vacancy: page(open, "https://hh.ru/vacancy/999"), negotiations: [page(listEmpty)] }),
        ID
      )._tag
    ).toBe("retry")
  })

  test("contradictions stay in reconcile", () => {
    const listedButOpen = judgeReconcile(
      exit({ vacancy: page(open, VACANCY_URL), negotiations: [page(listWith), page(listEmpty)] }),
      ID
    )
    expect(listedButOpen._tag).toBe("retry")
    const respondedButAbsent = judgeReconcile(
      exit({ vacancy: page(responded, VACANCY_URL), negotiations: [page(listOther), page(listEmpty)] }),
      ID
    )
    expect(respondedButAbsent._tag).toBe("retry")
  })

  test("login and captcha need a human, from the tag or from the pages", () => {
    expect(judgeReconcile({ tag: "session_expired" }, ID)._tag).toBe("human")
    expect(judgeReconcile({ tag: "captcha" }, ID)._tag).toBe("human")
    expect(
      judgeReconcile(
        exit({ vacancy: page("<html></html>", "https://hh.ru/account/login"), negotiations: [] }),
        ID
      )._tag
    ).toBe("human")
  })

  test("a bare claim is not evidence", () => {
    for (const tag of ["submitted", "already_responded", "not_submitted", "prepared", "blocked"] as const) {
      expect(judgeReconcile({ tag }, ID)._tag).toBe("retry")
      // Even a claim that carries unrelated artifacts.
      expect(judgeReconcile({ tag, artifacts: { clicked: true } }, ID)._tag).toBe("retry")
    }
    expect(judgeReconcile({ tag: "transport", message: "timeout" }, ID)._tag).toBe("retry")
  })

  test("evidence for another vacancy is refused", () => {
    const verdict = judgeReconcile(
      {
        tag: "reconciled",
        artifacts: { externalId: "1", vacancy: page(responded, "https://hh.ru/vacancy/1"), negotiations: [] }
      },
      ID
    )
    expect(verdict._tag).toBe("retry")
  })

  test("no verdict names a submit: unsent only describes", () => {
    const verdict = judgeReconcile(
      exit({ vacancy: page(open, VACANCY_URL), negotiations: [page(listEmpty)] }),
      ID
    )
    expect(Object.keys(verdict)).not.toContain("submit")
  })
})

describe("reconcileArtifacts", () => {
  test("keeps the reading and sizes, not the pages", () => {
    const evidence = exit({ vacancy: page(responded, VACANCY_URL), negotiations: [page(listWith)] })
    const kept = reconcileArtifacts(evidence, judgeReconcile(evidence, ID))
    expect(kept.verdict).toBe("submitted")
    expect(kept).toHaveProperty("reading")
    expect(JSON.stringify(kept)).not.toContain("HH-Lux-InitialState")
    expect(kept.vacancyBytes).toBe(responded.length)
  })
})
