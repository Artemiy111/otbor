import type { RoleFamily, Seniority } from "@otbor/contract"
import { normalizeText, titleCacheKey } from "./text.ts"

/**
 * A gate rule is a named regular expression. The name is what ends up in the
 * decision reasons and in the UI, so it must read like an explanation
 * ("sales", "warehouse"), not like a regex.
 */
export interface GateRule {
  readonly id: string
  readonly pattern: RegExp
}

export interface RoleGatePolicy {
  readonly role: RoleFamily
  readonly version: number
  readonly strong: ReadonlyArray<GateRule>
  readonly weak: ReadonlyArray<GateRule>
  readonly reject: ReadonlyArray<GateRule>
}

export interface RoleGateOutput {
  readonly role: RoleFamily
  readonly verdict: "match" | "unknown" | "reject"
  readonly titleNormalized: string
  readonly matched: ReadonlyArray<string>
  readonly rejectedBy: string | null
  readonly strong: ReadonlyArray<string>
  readonly weak: ReadonlyArray<string>
  readonly rulesVersion: number
}

const rule = (id: string, source: string, flags = "iu"): GateRule => ({
  id,
  pattern: new RegExp(source, flags)
})

/**
 * Default policy for a DevOps/platform account.
 *
 * Strong stems decide. Weak stems only say "maybe": they never auto-apply,
 * because "эксплуатация зданий" and "инженер эксплуатации" share a stem.
 * Negatives run first: "Менеджер по продажам DevOps-услуг" is a sales job.
 */
export const DEVOPS_GATE_POLICY: RoleGatePolicy = {
  role: "devops",
  version: 1,
  strong: [
    rule("devops", String.raw`(?<![\p{L}\p{N}_])dev[\s-]*ops(?![\p{L}\p{N}_])`),
    rule("девопс", String.raw`девопс`),
    rule("sre", String.raw`(?<![\p{L}\p{N}_])sre(?![\p{L}\p{N}_])`),
    rule("site reliability", String.raw`site[\s-]*reliability`),
    rule("platform engineer", String.raw`platform[\s-]*engineer`),
    rule("инженер платформы", String.raw`инженер\p{L}*\s+платформ`),
    rule("руководитель платформы", String.raw`руководител\p{L}*\s+платформ`)
  ],
  weak: [
    rule("облачные решения", String.raw`облачн`),
    rule("инфраструктура", String.raw`инфраструктур`),
    rule("эксплуатация", String.raw`эксплуатац`),
    rule("ci/cd", String.raw`ci[\s/-]*cd`),
    rule("kubernetes", String.raw`kubernetes|k8s|кубернет`),
    rule("linux", String.raw`linux|линукс`),
    rule("ansible", String.raw`ansible|ансибл`),
    rule("terraform", String.raw`terraform|терраформ`),
    rule("docker", String.raw`docker|докер`),
    rule("monitoring", String.raw`monitoring|мониторинг`),
    rule("reliability", String.raw`надежност`),
    rule("containers", String.raw`контейнер`),
    rule("automation", String.raw`автоматизац`),
    rule("cloud", String.raw`(?<![\p{L}\p{N}_])cloud(?![\p{L}\p{N}_])`)
  ],
  reject: [
    rule("системный администратор", String.raw`системн\p{L}*\s+администратор`),
    rule("продажи", String.raw`продаж`),
    rule("склад", String.raw`кладовщик|завсклад|складск`),
    rule("водитель", String.raw`(?<![\p{L}\p{N}_])водител\p{L}*`),
    rule("бухгалтер", String.raw`бухгалтер`),
    rule("поддержка пользователей", String.raw`поддержк\p{L}*\s+пользовател`),
    rule("рекрутинг", String.raw`рекрутер|recruiter|hr[\s-]*менеджер`),
    rule("дизайн", String.raw`дизайнер|designer`),
    rule("маркетинг", String.raw`маркетолог|маркетинг`),
    rule("юристы", String.raw`юрист|юридическ`),
    rule("охрана", String.raw`охранник|сторож`),
    rule("общепит", String.raw`повар|официант|бармен`),
    rule("курьеры", String.raw`курьер`),
    rule("call-центр", String.raw`call[\s-]*центр|оператор\s+call`),
    rule("менеджер по персоналу", String.raw`менеджер\s+по\s+персоналу`),
    rule("секретарь", String.raw`секретар`),
    rule("экономист", String.raw`экономист`)
  ]
}

/**
 * The gate deliberately matches the title only.
 *
 * A warehouse job that mentions Kubernetes in "nice to have" is still a
 * warehouse job; the opposite ("DevOps" with no Kubernetes) is still worth a
 * look. Body text influences fit, not identity.
 */
export const gateTitle = (
  title: string,
  policy: RoleGatePolicy = DEVOPS_GATE_POLICY
): RoleGateOutput => {
  const text = normalizeText(title)

  const rejected = policy.reject.find((r) => {
    r.pattern.lastIndex = 0
    return r.pattern.test(text)
  })
  if (rejected !== undefined) {
    return {
      role: policy.role,
      verdict: "reject",
      titleNormalized: titleCacheKey(title),
      matched: [rejected.id],
      rejectedBy: rejected.id,
      strong: [],
      weak: [],
      rulesVersion: policy.version
    }
  }

  const strong = policy.strong
    .filter((r): boolean => {
      r.pattern.lastIndex = 0
      return r.pattern.test(text)
    })
    .map((r) => r.id)

  const weak = policy.weak
    .filter((r): boolean => {
      r.pattern.lastIndex = 0
      return r.pattern.test(text)
    })
    .map((r) => r.id)

  return {
    role: policy.role,
    verdict: strong.length > 0 ? "match" : "unknown",
    titleNormalized: titleCacheKey(title),
    matched: [...strong, ...weak],
    rejectedBy: null,
    strong,
    weak,
    rulesVersion: policy.version
  }
}

const JUNIOR =
  /(?<![\p{L}\p{N}_])(junior|intern|trainee|джун\p{L}*|стажер\p{L}*|начинающ\p{L}*)(?![\p{L}\p{N}_])/iu
const MIDDLE = /(?<![\p{L}\p{N}_])(middle|мидл\p{L}*)(?![\p{L}\p{N}_])/iu
const SENIOR =
  /(?<![\p{L}\p{N}_])(senior|principal|staff|сеньор\p{L}*|ведущ\p{L}*|старш\p{L}*)(?![\p{L}\p{N}_])/iu
const LEAD =
  /(?<![\p{L}\p{N}_])(lead|head|руководител\p{L}*|директор\p{L}*)(?![\p{L}\p{N}_])/iu

/**
 * Seniority is descriptive, never a hard gate. A lead role is a different
 * conversation, not a reason to hide the vacancy.
 */
export const detectSeniority = (title: string, body = ""): Seniority => {
  const titleText = normalizeText(title)
  const bodyText = normalizeText(body)

  const check = (pattern: RegExp, text: string): boolean => {
    pattern.lastIndex = 0
    return pattern.test(text)
  }

  if (check(LEAD, titleText) || check(LEAD, bodyText)) return "lead"
  if (check(SENIOR, titleText) || check(SENIOR, bodyText)) return "senior"
  if (check(MIDDLE, titleText) || check(MIDDLE, bodyText)) return "middle"
  if (check(JUNIOR, titleText) || check(JUNIOR, bodyText)) return "junior"
  return "unknown"
}
