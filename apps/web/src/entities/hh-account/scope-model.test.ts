import { describe, expect, test } from "bun:test"
import { resolveAccountView } from "./scope-model"

const accounts = [
  { id: "a", isDefault: false },
  { id: "b", isDefault: true }
]

describe("resolveAccountView", () => {
  test("пока выбор не сделан, фильтр равен основному аккаунту с сервера", () => {
    const view = resolveAccountView(accounts, "")
    expect(view.serverDefaultId).toBe("b")
    expect(view.viewId).toBe("b")
    expect(view.viewAccountId).toBe("b")
  })

  test("сохранённый аккаунт сильнее основного, но основной не меняется", () => {
    const view = resolveAccountView(accounts, "a")
    expect(view.viewId).toBe("a")
    expect(view.serverDefaultId).toBe("b")
    expect(view.actingAccountId).toBe("a")
  })

  test("«все аккаунты»: списки без фильтра, действия идут от основного", () => {
    const view = resolveAccountView(accounts, "all")
    expect(view.viewAccountId).toBeUndefined()
    expect(view.actingAccountId).toBe("b")
  })

  test("пропавший аккаунт заменяется основным", () => {
    expect(resolveAccountView(accounts, "gone").viewId).toBe("b")
  })

  test("без основного берётся первый, без аккаунтов выбора нет", () => {
    expect(resolveAccountView([{ id: "x", isDefault: false }], "").viewId).toBe("x")
    const none = resolveAccountView([], "")
    expect(none.viewId).toBe("all")
    expect(none.actingAccountId).toBeUndefined()
  })
})
