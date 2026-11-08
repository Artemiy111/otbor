import { describe, expect, test } from "bun:test"
import { deriveStage } from "../src/services/AutoApplyViewService.ts"

const NOW = Date.parse("2026-11-08T12:00:00Z")
const HOURS = 3_600_000

type Row = Parameters<typeof deriveStage>[0]

/** Черновик с формой, прочитанной `ageHours` часов назад, без кита и задач. */
const row = (patch: Partial<Record<keyof Row, unknown>> = {}, ageHours = 1): Row =>
  ({
    id: "a",
    vacancy_id: "v",
    title: "t",
    employer_name: null,
    resume_title: null,
    auto_run: "drafts",
    state: "draft",
    last_error: null,
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    submitted_at: null,
    form_status: "ok",
    form_checked_at: new Date(NOW - ageHours * HOURS),
    form_hash: "h",
    kit_letter: null,
    kit_answers: null,
    kit_exists: false,
    write_id: null,
    write_status: null,
    write_attempts: null,
    write_max: null,
    write_created: null,
    write_updated: null,
    write_error: null,
    write_text: null,
    submit_status: null,
    intent_at: null,
    write_retries: null,
    read_status: null,
    ...patch
  }) as Row

describe("deriveStage", () => {
  test("a stored kit shows as ready even when the form is older than 24 hours", () => {
    const stale = deriveStage(row({ kit_exists: true }, 100), NOW)
    expect(stale.stage).toBe("kit_ready")
    expect(stale.detail).toContain("Кит готов, ждёт вашей отправки")
    expect(stale.detail).toContain("форма перечитается перед отправкой")

    const fresh = deriveStage(row({ kit_exists: true }), NOW)
    expect(fresh).toEqual({ stage: "kit_ready", detail: "Кит готов, ждёт вашей отправки" })

    expect(deriveStage(row({ kit_exists: true, auto_run: "auto", state: "preparing" }, 100), NOW).detail).toContain(
      "отправка в очереди"
    )
  })

  test("without a kit a stale form still waits for the read", () => {
    expect(deriveStage(row({}, 100), NOW)).toEqual({ stage: "waiting", detail: "Ждёт чтения формы" })
  })

  test("a running form read wins over a kit", () => {
    expect(deriveStage(row({ kit_exists: true, read_status: "running" }), NOW).stage).toBe("reading_form")
  })

  test("a switched-off mode is said out loud, except for a finished draft", () => {
    expect(deriveStage(row({ governing_mode: "off" }), NOW)).toEqual({
      stage: "waiting",
      detail: "Режим автоотклика выключен — не обрабатывается"
    })
    expect(deriveStage(row({ governing_mode: "off", kit_exists: true }), NOW).stage).toBe("kit_ready")
    expect(deriveStage(row({ governing_mode: "auto" }), NOW).stage).toBe("waiting")
  })
})
