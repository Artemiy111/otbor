import { describe, expect, test } from "bun:test"
import { buildAttention, type AttentionInput } from "./attention"
import { ago, makeHealth, makeOverview, NOW, overviewWithAccount } from "./overview.fixture"
import { buildVerdict } from "./verdict"

const verdictFor = (patch: Partial<AttentionInput> = {}) => {
  const input: AttentionInput = {
    overview: makeOverview(),
    health: makeHealth(),
    healthFailed: false,
    schedules: [],
    proxy: undefined,
    now: NOW,
    ...patch
  }
  return buildVerdict({ ...input, items: buildAttention(input) })
}

describe("buildVerdict", () => {
  test("всё хорошо: успех и счёт за сутки", () => {
    expect(verdictFor()).toMatchObject({
      tone: "success",
      glyph: "ok",
      headline: "Всё работает.",
      detail: "Автоотклики идут: за сутки отправлено 37 из 200."
    })
  })

  test("сервер недоступен", () => {
    expect(verdictFor({ overview: undefined, health: undefined, healthFailed: true })).toMatchObject({
      tone: "danger",
      headline: "Сервер недоступен."
    })
  })

  test("данных ещё нет: нейтральная загрузка", () => {
    expect(verdictFor({ overview: undefined, health: undefined })).toMatchObject({ tone: "neutral", glyph: "loading" })
  })

  test("база недоступна", () => {
    expect(verdictFor({ health: makeHealth({ database: false }) }).headline).toBe("База данных недоступна.")
  })

  test("капча на единственном автоаккаунте останавливает отклики", () => {
    const overview = overviewWithAccount({
      submitBlockedAt: ago(2),
      submitBlockReason: "captcha",
      submitRetryAt: new Date(NOW + 600_000).toISOString()
    })
    expect(verdictFor({ overview })).toMatchObject({
      tone: "danger",
      headline: "Отклики остановлены: hh просит капчу на аккаунте Иван."
    })
  })

  test("нужно участие: считаются только вопросы, не «к сведению»", () => {
    const overview = makeOverview({
      applications: {
        ...makeOverview().applications,
        draftsToReview: 30,
        needsAttention: [
          { state: "needs_human", reason: "kit_refused", count: 4, oldestAt: ago(10) },
          { state: "needs_human", reason: null, count: 1, oldestAt: ago(10) },
          { state: "needs_human", reason: "writing_failed", count: 2, oldestAt: ago(10) }
        ]
      }
    })
    expect(verdictFor({ overview })).toMatchObject({
      tone: "warning",
      headline: "Нужно ваше участие: 3 вопроса."
    })
  })

  test("срочная проблема красит весь блок в danger", () => {
    const overview = makeOverview({
      applications: {
        ...makeOverview().applications,
        needsAttention: [{ state: "failed", reason: null, count: 1, oldestAt: ago(5) }]
      }
    })
    expect(verdictFor({ overview }).tone).toBe("danger")
  })

  test("автоотклики выключены: нейтрально и без тревоги", () => {
    const overview = overviewWithAccount({ autoModes: [{ resumeId: null, resumeTitle: null, autoMode: "off" }] })
    expect(verdictFor({ overview })).toMatchObject({
      tone: "neutral",
      glyph: "idle",
      headline: "Автоотклики выключены — система только собирает вакансии."
    })
  })

  test("черновики и диалоги не мешают словам «Всё работает»", () => {
    const overview = makeOverview({
      applications: { ...makeOverview().applications, draftsToReview: 12 },
      inbox: { unreadConversations: 1, lastInboundAt: ago(1) }
    })
    const verdict = verdictFor({ overview })
    expect(verdict.headline).toBe("Всё работает.")
    expect(verdict.detail).toContain("Ждут вас: 12 черновиков и 1 диалог без ответа.")
  })

  test("нет исполнителя браузера: отклики не отправляются", () => {
    expect(verdictFor({ health: makeHealth({ harnesses: [] }) }).headline).toBe(
      "Исполнитель браузера не подключён: отклики не отправляются."
    )
  })

  test("снимок не собрался: предупреждение, а не вечная загрузка", () => {
    const input: AttentionInput = {
      overview: undefined,
      health: makeHealth(),
      healthFailed: false,
      schedules: [],
      proxy: undefined,
      now: NOW
    }
    expect(buildVerdict({ ...input, items: [], overviewFailed: true })).toMatchObject({
      tone: "warning",
      headline: "Не удалось получить данные обзора."
    })
  })
})
