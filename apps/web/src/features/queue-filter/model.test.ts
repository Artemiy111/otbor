import { describe, expect, test } from "bun:test"
import { parseQueueFilter, queueFilterSearch, queueStatusOptions, valueList } from "./model"

describe("queue filter in the URL", () => {
  test("читает вкладку, статусы и стадии, чужие значения отбрасывает", () => {
    expect(parseQueueFilter("?tab=inference&status=failed,dead,bogus&stage=inference")).toEqual({
      tab: "inference",
      status: ["failed", "dead"],
      stage: ["inference"]
    })
    expect(parseQueueFilter("?tab=nope")).toEqual({ tab: "browser", status: [], stage: [] })
    expect(parseQueueFilter("")).toEqual({ tab: "browser", status: [], stage: [] })
  })

  test("пишет только то, что отличается от умолчаний", () => {
    expect(queueFilterSearch({ tab: "browser", status: [], stage: [] })).toBe("")
    expect(queueFilterSearch({ tab: "background", status: [], stage: [] })).toBe("tab=background")
    const search = queueFilterSearch({ tab: "browser", status: ["needs_human", "needs_reconcile"], stage: ["submit"] })
    expect(parseQueueFilter(search)).toEqual({ tab: "browser", status: ["needs_human", "needs_reconcile"], stage: ["submit"] })
  })

  test("значение списка: группа статусов раскладывается, «все» - пусто", () => {
    expect(valueList("all")).toEqual([])
    expect(valueList("leased,running")).toEqual(["leased", "running"])
  })

  test("подписи состояний без служебных кодов", () => {
    expect(queueStatusOptions.every((option) => !/\(/.test(option.label))).toBe(true)
  })
})
