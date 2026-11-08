import type { HarnessExit } from "@otbor/contract"
import { describe, expect, test } from "bun:test"
import { judgeResumeSync } from "../src/services/applyRules.ts"

const HASH = "0123456789abcdef0123456789abcdef01234567"
const profile = `<div data-qa="resume" data-qa-id="555" data-qa-title="DevOps"><a href="/resume/${HASH}">x</a></div>`
const resume = `<template id="HH-Lux-InitialState">${JSON.stringify({
  applicantResume: {
    _attributes: { hash: HASH, id: 555 },
    title: "DevOps",
    skills: "About me",
    keySkills: ["Kubernetes"]
  }
})}</template>`

const exit = (profileHtml: string, resumes: ReadonlyArray<string>, tag: HarnessExit["tag"] = "reconciled"): HarnessExit => ({
  tag,
  artifacts: {
    profile: { url: "https://hh.ru/applicant/profile/me", html: profileHtml },
    resumes: resumes.map((html) => ({ url: `https://hh.ru/resume/${HASH}`, html }))
  }
})

describe("judgeResumeSync", () => {
  test("reads the cards and the resume pages", () => {
    const verdict = judgeResumeSync(exit(profile, [resume]))
    expect(verdict._tag).toBe("read")
    if (verdict._tag !== "read") return
    expect(verdict.found).toBe(1)
    expect(verdict.unreadable).toBe(0)
    expect(verdict.resumes[0]?.title).toBe("DevOps")
  })

  test("a card whose page is unreadable is counted, not stored", () => {
    const verdict = judgeResumeSync(exit(profile, ["<html>oops</html>"]))
    expect(verdict._tag === "read" && verdict.unreadable).toBe(1)
    expect(verdict._tag === "read" && verdict.resumes.length).toBe(0)
  })

  test("a profile without cards is a retry, never an empty list", () => {
    expect(judgeResumeSync(exit("<html></html>", []))._tag).toBe("retry")
    expect(judgeResumeSync({ tag: "reconciled" })._tag).toBe("retry")
    expect(judgeResumeSync({ tag: "transport", message: "x" })._tag).toBe("retry")
  })

  test("текст блока «Контакты» доходит до вердикта; у старых заданий его нет", () => {
    const base = exit(profile, [resume])
    const withText: HarnessExit = {
      ...base,
      artifacts: { ...(base.artifacts as object), profileContactsText: "Контакты\nТелефон\n+7 995 260-41-35" }
    }
    const verdict = judgeResumeSync(withText)
    expect(verdict._tag === "read" && verdict.contactsText).toBe("Контакты\nТелефон\n+7 995 260-41-35")
    const old = judgeResumeSync(base)
    expect(old._tag === "read" && old.contactsText).toBeUndefined()
  })

  test("session and captcha need a human", () => {
    expect(judgeResumeSync({ tag: "session_expired" })._tag).toBe("human")
    expect(judgeResumeSync({ tag: "captcha" })._tag).toBe("human")
  })
})
