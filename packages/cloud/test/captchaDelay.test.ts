import { describe, expect, test } from "bun:test"
import { captchaDelayMinutes } from "../src/repositories/SubmitPacingRepository.ts"

describe("captchaDelayMinutes", () => {
  test("удваивается за каждую капчу подряд и упирается в потолок", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(captchaDelayMinutes)).toEqual([10, 20, 40, 60, 60, 60, 60])
  })
})
