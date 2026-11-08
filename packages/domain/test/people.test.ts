import { describe, expect, test } from "bun:test"
import {
  attributeCandidates,
  excludeOwn,
  normalizeIdentity,
  rankResumeLinks,
  rankVacancyLinks,
  resolvePerson
} from "../src/index.ts"

const incoming = (text: string) => ({ direction: "in" as const, text })
const outgoing = (text: string) => ({ direction: "out" as const, text })

describe("attributeCandidates", () => {
  test("self-reference in an incoming message makes the contact counterparty", () => {
    const [found] = attributeCandidates([incoming("Пишите мне в телеграм @Ivan_HR")])
    expect(found?.kind).toBe("telegram")
    expect(found?.value).toBe("@ivan_hr")
    expect(found?.attribution).toBe("counterparty")
    expect(found?.confidence).toBeGreaterThanOrEqual(0.85)
  })

  test.each([
    "Мой тг: @ivan_hr",
    "Мои контакты: ivan@corp.ru",
    "Звоните +7 999 123-45-67",
    "Мне можно написать на ivan@corp.ru"
  ])("first-person marker: %s", (text) => {
    const found = attributeCandidates([incoming(text)])
    expect(found).toHaveLength(1)
    expect(found[0]?.attribution).toBe("counterparty")
  })

  test("a contact of someone else stays mentioned with low confidence", () => {
    const [found] = attributeCandidates([incoming("Его телеграм @petr_dev, спросите там")])
    expect(found?.attribution).toBe("mentioned")
    expect(found?.confidence).toBeLessThanOrEqual(0.5)
  })

  test("a bare contact with no marker is only mentioned", () => {
    const [found] = attributeCandidates([incoming("Вакансия описана тут: hr@corp.ru")])
    expect(found?.attribution).toBe("mentioned")
  })

  test("a marker belonging to another person does not count", () => {
    const [found] = attributeCandidates([incoming("Мой коллега, его тг @petr_dev")])
    expect(found?.attribution).toBe("mentioned")
  })

  test("contacts in outgoing messages are the applicant's own and dropped", () => {
    expect(attributeCandidates([outgoing("Мой телеграм @me_user, пишите мне")])).toEqual([])
  })

  test("a handle equal to the dialog's own username is the counterparty", () => {
    const found = attributeCandidates([incoming("Вот контакт @Ivan_HR")], {
      counterpartyUsername: "ivan_hr"
    })
    expect(found).toHaveLength(1)
    expect(found[0]?.attribution).toBe("counterparty")
    expect(found[0]?.confidence).toBe(1)
  })

  test("dialog username and id become counterparty identities by themselves", () => {
    const found = attributeCandidates([], {
      counterpartyUsername: "@Anna",
      counterpartyTelegramId: "12345"
    })
    expect(found.map((item) => `${item.kind}:${item.value}`).sort()).toEqual([
      "telegram:@anna",
      "telegram_id:12345"
    ])
  })

  test("counterparty beats mentioned for the same identity across messages", () => {
    const found = attributeCandidates([
      incoming("Пишут из hr@corp.ru"),
      incoming("Мой email hr@corp.ru")
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.attribution).toBe("counterparty")
  })

  test("bots and invite links are not identities of a person", () => {
    const found = attributeCandidates([
      incoming("Мой бот @jobs_bot"),
      incoming("Мой чат https://t.me/+AbCdEfGh12345")
    ])
    expect(found).toEqual([])
  })

  test("hh vacancy ids and chat links are not identities", () => {
    expect(attributeCandidates([incoming("Мне нравится https://hh.ru/vacancy/123456789")])).toEqual([])
  })
})

describe("excludeOwn", () => {
  const candidates = [
    { kind: "email", value: "me@mail.ru" },
    { kind: "email", value: "hr@corp.ru" },
    { kind: "phone", value: "+79991234567" },
    { kind: "telegram", value: "@me_user" },
    { kind: "telegram_id", value: "42" }
  ]

  test("drops identities equal to the applicant's own after normalization", () => {
    const left = excludeOwn(candidates, {
      emails: ["ME@Mail.ru"],
      phones: ["8 (999) 123-45-67"],
      telegramUsernames: ["Me_User"],
      telegramIds: ["42"]
    })
    expect(left).toEqual([{ kind: "email", value: "hr@corp.ru" }])
  })

  test("keeps everything when nothing is own", () => {
    expect(excludeOwn(candidates, {})).toHaveLength(5)
  })

  test("a phone is not confused with an email of the same text", () => {
    expect(excludeOwn(candidates, { emails: ["+79991234567"] })).toHaveLength(5)
  })
})

describe("normalizeIdentity", () => {
  test("normalizes each kind", () => {
    expect(normalizeIdentity("email", " A@B.ru ")).toBe("a@b.ru")
    expect(normalizeIdentity("phone", "8 999 123 45 67")).toBe("+79991234567")
    expect(normalizeIdentity("telegram", "Foo_Bar")).toBe("@foo_bar")
    expect(normalizeIdentity("telegram_id", " 42 ")).toBe("42")
  })
})

describe("resolvePerson", () => {
  const strong = (kind: string, value: string) => ({
    kind,
    value,
    attribution: "counterparty" as const,
    confidence: 0.9
  })
  const mentioned = (kind: string, value: string) => ({
    kind,
    value,
    attribution: "mentioned" as const,
    confidence: 0.4
  })

  test("nothing strong means no person", () => {
    const result = resolvePerson({
      identities: [mentioned("email", "x@y.ru")],
      existing: []
    })
    expect(result).toEqual({ action: "none", identityLinks: [], mergeSuggestions: [] })
  })

  test("a counterparty with confidence below 0.8 cannot create a person", () => {
    const result = resolvePerson({
      identities: [{ ...strong("email", "x@y.ru"), confidence: 0.79 }],
      existing: []
    })
    expect(result.action).toBe("none")
  })

  test("creates a person for new counterparty identities, mentions become suggested", () => {
    const result = resolvePerson({
      identities: [strong("email", "a@b.ru"), mentioned("telegram", "@other")],
      existing: []
    })
    expect(result.action).toBe("create")
    expect(result.identityLinks).toEqual([
      { kind: "email", value: "a@b.ru", personLink: "auto" },
      { kind: "telegram", value: "@other", personLink: "suggested" }
    ])
  })

  test("attaches to the person that already owns a matching email", () => {
    const result = resolvePerson({
      identities: [strong("email", "a@b.ru"), strong("telegram", "@ann")],
      existing: [{ kind: "email", value: "A@b.ru", personId: "P1" }]
    })
    expect(result.action).toBe("attach")
    expect(result.personId).toBe("P1")
    expect(result.identityLinks.map((item) => item.personLink)).toEqual(["auto", "auto"])
  })

  test("never steals a mentioned contact that belongs to another person", () => {
    const result = resolvePerson({
      identities: [strong("email", "a@b.ru"), mentioned("telegram", "@owned")],
      existing: [{ kind: "telegram", value: "@owned", personId: "P2" }]
    })
    expect(result.action).toBe("create")
    expect(result.identityLinks).toEqual([{ kind: "email", value: "a@b.ru", personLink: "auto" }])
  })

  test("two persons behind strong identities: no merge, only a suggestion", () => {
    const result = resolvePerson({
      identities: [strong("email", "a@b.ru"), strong("phone", "+79991234567")],
      existing: [
        { kind: "email", value: "a@b.ru", personId: "P2" },
        { kind: "phone", value: "+79991234567", personId: "P1" }
      ]
    })
    expect(result.action).toBe("none")
    expect(result.personId).toBeUndefined()
    expect(result.identityLinks).toEqual([])
    expect(result.mergeSuggestions).toHaveLength(1)
    expect(result.mergeSuggestions[0]).toMatchObject({ a: "P1", b: "P2" })
  })

  test("a username match alone is weaker than email: person is kept, merge only suggested", () => {
    const result = resolvePerson({
      identities: [strong("email", "a@b.ru"), strong("telegram", "@ann")],
      existing: [
        { kind: "email", value: "a@b.ru", personId: "P1" },
        { kind: "telegram", value: "@ann", personId: "P2" }
      ]
    })
    expect(result.action).toBe("attach")
    expect(result.personId).toBe("P1")
    expect(result.mergeSuggestions).toHaveLength(1)
    expect(result.identityLinks).toEqual([{ kind: "email", value: "a@b.ru", personLink: "auto" }])
  })

  test("a lone username match attaches", () => {
    const result = resolvePerson({
      identities: [strong("telegram", "@ann")],
      existing: [{ kind: "telegram", value: "@ann", personId: "P2" }]
    })
    expect(result).toMatchObject({ action: "attach", personId: "P2" })
  })

  test("a contact without a person does not count as an owner", () => {
    const result = resolvePerson({
      identities: [strong("telegram_id", "42")],
      existing: [{ kind: "telegram_id", value: "42", personId: null }]
    })
    expect(result.action).toBe("create")
  })
})

describe("rankVacancyLinks", () => {
  test("hh chat is primary with confidence 1", () => {
    expect(rankVacancyLinks([{ vacancyId: "V1", kind: "hh_chat" }])).toEqual([
      { vacancyId: "V1", kind: "primary", confidence: 1, source: "hh_chat" }
    ])
  })

  test("only the highest non-candidate is primary", () => {
    const links = rankVacancyLinks([
      { vacancyId: "V1", kind: "contact_in_vacancy" },
      { vacancyId: "V2", kind: "url_in_text" },
      { vacancyId: "V3", kind: "url_in_text" }
    ])
    expect(links.filter((item) => item.kind === "primary")).toEqual([
      { vacancyId: "V2", kind: "primary", confidence: 1, source: "url_in_text" }
    ])
    expect(links.map((item) => [item.vacancyId, item.kind])).toEqual([
      ["V2", "primary"],
      ["V3", "mentioned"],
      ["V1", "mentioned"]
    ])
    expect(links[2]?.confidence).toBe(0.9)
  })

  test("a hh chat wins a tie with a url", () => {
    const links = rankVacancyLinks([
      { vacancyId: "V1", kind: "url_in_text" },
      { vacancyId: "V2", kind: "hh_chat" }
    ])
    expect(links[0]).toMatchObject({ vacancyId: "V2", kind: "primary" })
  })

  test("person inference is always a candidate, never primary", () => {
    expect(rankVacancyLinks([{ vacancyId: "V1", kind: "person_inference" }])).toEqual([
      { vacancyId: "V1", kind: "candidate", confidence: 0.4, source: "person_inference" }
    ])
  })

  test("a candidate and a direct signal for one vacancy keep the direct one", () => {
    const links = rankVacancyLinks([
      { vacancyId: "V1", kind: "person_inference" },
      { vacancyId: "V1", kind: "contact_in_vacancy" },
      { vacancyId: "V2", kind: "person_inference" }
    ])
    expect(links).toEqual([
      { vacancyId: "V1", kind: "primary", confidence: 0.9, source: "contact_in_vacancy" },
      { vacancyId: "V2", kind: "candidate", confidence: 0.4, source: "person_inference" }
    ])
  })

  test("no signals, no links", () => {
    expect(rankVacancyLinks([])).toEqual([])
  })
})

describe("rankResumeLinks", () => {
  test("the hh chat resume is exact", () => {
    const links = rankResumeLinks({
      vacancyApplications: [{ vacancyId: "V", resumeId: "R2", hhAccountId: "A" }],
      telegramHhAccountIds: [],
      hhChatResumeId: "R1"
    })
    expect(links).toEqual([{ resumeId: "R1", confidence: 1, source: "hh_chat" }])
  })

  test("telegram account intersected with applications gives 0.9", () => {
    const links = rankResumeLinks({
      vacancyIds: ["V"],
      vacancyApplications: [
        { vacancyId: "V", resumeId: "R1", hhAccountId: "A1" },
        { vacancyId: "V", resumeId: "R2", hhAccountId: "A2" }
      ],
      telegramHhAccountIds: ["A2"]
    })
    expect(links).toEqual([{ resumeId: "R2", confidence: 0.9, source: "tg_vacancy_account" }])
  })

  test("applications on V with a single resume give 0.7", () => {
    const links = rankResumeLinks({
      vacancyIds: ["V"],
      vacancyApplications: [{ vacancyId: "V", resumeId: "R1", hhAccountId: "A1" }],
      telegramHhAccountIds: []
    })
    expect(links).toEqual([{ resumeId: "R1", confidence: 0.7, source: "vacancy_application" }])
  })

  test("applications of other vacancies are ignored", () => {
    const links = rankResumeLinks({
      vacancyIds: ["V"],
      vacancyApplications: [{ vacancyId: "OTHER", resumeId: "R1", hhAccountId: "A1" }],
      telegramHhAccountIds: []
    })
    expect(links).toEqual([])
  })

  test("two resumes applied to V and no intersection is ambiguous", () => {
    const links = rankResumeLinks({
      vacancyIds: ["V"],
      vacancyApplications: [
        { vacancyId: "V", resumeId: "R1", hhAccountId: "A1" },
        { vacancyId: "V", resumeId: "R2", hhAccountId: "A2" }
      ],
      telegramHhAccountIds: []
    })
    expect(links).toEqual([])
  })

  test("no application: one account with one active resume gives 0.4", () => {
    const links = rankResumeLinks({
      vacancyIds: ["V"],
      vacancyApplications: [],
      telegramHhAccountIds: ["A1"],
      accountResumes: [
        { resumeId: "R1", hhAccountId: "A1", active: true },
        { resumeId: "R9", hhAccountId: "A1", active: false },
        { resumeId: "R5", hhAccountId: "A2", active: true }
      ]
    })
    expect(links).toEqual([{ resumeId: "R1", confidence: 0.4, source: "tg_account" }])
  })

  test("no application: several accounts or several active resumes is ambiguous", () => {
    expect(
      rankResumeLinks({
        vacancyApplications: [],
        telegramHhAccountIds: ["A1", "A2"],
        accountResumes: [{ resumeId: "R1", hhAccountId: "A1", active: true }]
      })
    ).toEqual([])
    expect(
      rankResumeLinks({
        vacancyApplications: [],
        telegramHhAccountIds: ["A1"],
        accountResumes: [
          { resumeId: "R1", hhAccountId: "A1", active: true },
          { resumeId: "R2", hhAccountId: "A1", active: true }
        ]
      })
    ).toEqual([])
  })
})
