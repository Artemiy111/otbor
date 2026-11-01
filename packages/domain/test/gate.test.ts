import { describe, expect, test } from "bun:test"
import { DEVOPS_GATE_POLICY, detectSeniority, gateTitle } from "../src/gate.ts"

describe("gateTitle", () => {
  test("matches a strong DevOps title", () => {
    const result = gateTitle("Senior DevOps Engineer")
    expect(result.verdict).toBe("match")
    expect(result.strong).toContain("devops")
    expect(result.titleNormalized).toBe("devops engineer")
  })

  test("matches Russian and spaced variants", () => {
    expect(gateTitle("Инженер Dev Ops").verdict).toBe("match")
    expect(gateTitle("DevOps-инженер").verdict).toBe("match")
    expect(gateTitle("SRE / Platform Engineer").verdict).toBe("match")
  })

  test("weak stems are unknown, not match", () => {
    const cloud = gateTitle("Инженер облачных решений")
    expect(cloud.verdict).toBe("unknown")
    expect(cloud.weak).toContain("облачные решения")

    const infra = gateTitle("Специалист по инфраструктуре")
    expect(infra.verdict).toBe("unknown")
  })

  test("negatives win over strong stems", () => {
    const result = gateTitle("Менеджер по продажам DevOps-услуг")
    expect(result.verdict).toBe("reject")
    expect(result.rejectedBy).toBe("продажи")
  })

  test("a systems administrator is a different role", () => {
    const result = gateTitle("Системный администратор Linux")
    expect(result.verdict).toBe("reject")
    expect(result.rejectedBy).toBe("системный администратор")
  })

  test("a manager of DevOps is a match, not a reject", () => {
    expect(gateTitle("Руководитель DevOps").verdict).toBe("match")
  })

  test("warehouse jobs do not match", () => {
    expect(gateTitle("Кладовщик").verdict).toBe("reject")
    expect(gateTitle("Водитель-экспедитор").verdict).toBe("reject")
  })

  test("an unrelated title is unknown, not garbage", () => {
    expect(gateTitle("Менеджер проектов").verdict).toBe("unknown")
  })

  test("policy version is carried into the result", () => {
    expect(gateTitle("DevOps").rulesVersion).toBe(DEVOPS_GATE_POLICY.version)
  })
})

describe("detectSeniority", () => {
  test("detects from the title", () => {
    expect(detectSeniority("Junior DevOps")).toBe("junior")
    expect(detectSeniority("Middle SRE")).toBe("middle")
    expect(detectSeniority("Senior Platform Engineer")).toBe("senior")
    expect(detectSeniority("Руководитель DevOps")).toBe("lead")
  })

  test("lead wins over senior when both are present", () => {
    expect(detectSeniority("Senior Team Lead")).toBe("lead")
  })

  test("falls back to the body", () => {
    expect(detectSeniority("DevOps инженер", "Опыт от 6 лет, senior-уровень")).toBe("senior")
  })

  test("returns unknown without a marker", () => {
    expect(detectSeniority("DevOps инженер")).toBe("unknown")
  })
})
