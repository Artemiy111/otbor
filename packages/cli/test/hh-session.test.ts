import { describe, expect, test } from "bun:test"
import { fullName, isReplaceableLabel, judgeSessionResponse, parseProfileName } from "../src/hh-session.ts"

describe("hh session helpers", () => {
  test("parses the applicant name from the profile page", () => {
    const html = `{&quot;firstName&quot;:&quot;Иван&quot;,&quot;lastName&quot;:&quot;Петров&quot;}`
    expect(fullName(parseProfileName(html))).toBe("Иван Петров")
    expect(parseProfileName("<html/>")).toEqual({ firstName: null, lastName: null })
  })

  test("only empty or legacy labels are replaceable", () => {
    expect(isReplaceableLabel("local")).toBe(true)
    expect(isReplaceableLabel("")).toBe(true)
    expect(isReplaceableLabel(" Local ")).toBe(true)
    expect(isReplaceableLabel("Work account")).toBe(false)
  })

  test("verdicts: ok, anonymous, login redirect, captcha", () => {
    const url = "https://hh.ru/applicant/profile/me"
    expect(judgeSessionResponse({ status: 200, url, html: "<html>ok</html>" }).state).toBe("ok")
    expect(judgeSessionResponse({ status: 200, url, html: `"userType": "anonymous"` }).state).toBe("expired")
    expect(judgeSessionResponse({ status: 200, url: "https://hh.ru/account/login", html: "" }).state).toBe("expired")
    expect(judgeSessionResponse({ status: 200, url: "https://hh.ru/account/captcha", html: "" }).state).toBe("blocked")
    expect(judgeSessionResponse({ status: 429, url, html: "" }).state).toBe("blocked")
  })
})
