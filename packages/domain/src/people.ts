/**
 * Люди: чистая логика привязки контактов к человеку-собеседнику.
 *
 * Контакт — это идентичность (email, телефон, @username, числовой id в
 * Telegram), а не человек. Здесь решается, чьей идентичностью является найденный
 * в переписке контакт (собеседника, чужой или свой), к какому человеку его
 * привязать и с какой уверенностью связать диалог с вакансией и резюме.
 *
 * Ни базы, ни сети, ни времени: всё детерминировано и покрыто тестами.
 */
import { extractContactsFromText, normalizePhone } from "./contacts.ts"

/** Виды контактов, которыми можно однозначно описать человека. */
export type IdentityKind = "email" | "phone" | "telegram" | "telegram_id"

/**
 * Идентичности, совпадение которых считается надёжным сигналом «это один
 * человек». @username можно сменить и передать другому, поэтому он не входит.
 */
const SURE_KINDS: ReadonlySet<string> = new Set(["email", "phone", "telegram_id"])

export type Attribution = "counterparty" | "mentioned"

/** Минимальная уверенность, с которой идентичность вправе создать/выбрать человека. */
export const AUTO_LINK_CONFIDENCE = 0.8

const COUNTERPARTY_CONFIDENCE = 0.9
const DIALOG_CONFIDENCE = 1
const MENTIONED_CONFIDENCE = 0.4

/* -------------------------------------------------------------------------- */
/* Нормализация                                                               */
/* -------------------------------------------------------------------------- */

/** Приводит значение идентичности к виду, в котором оно хранится и сравнивается. */
export const normalizeIdentity = (kind: string, value: string): string => {
  const trimmed = value.trim()
  switch (kind) {
    case "email":
      return trimmed.toLowerCase()
    case "phone":
      return normalizePhone(trimmed) ?? trimmed
    case "telegram": {
      const bare = trimmed.replace(/^@/, "").toLowerCase()
      return bare === "" || /^https?:\/\//iu.test(trimmed) ? trimmed : `@${bare}`
    }
    case "telegram_id":
      return trimmed.replace(/\D/g, "") || trimmed
    default:
      return trimmed
  }
}

const identityKey = (kind: string, value: string): string =>
  `${kind}:${normalizeIdentity(kind, value)}`

/* -------------------------------------------------------------------------- */
/* attributeCandidates                                                         */
/* -------------------------------------------------------------------------- */

export interface AttributionMessage {
  readonly direction: "in" | "out"
  readonly text: string | null
}

export interface AttributionContextInput {
  /** Имя собеседника из заголовка диалога. */
  readonly counterpartyName?: string | null
  /** Собственный username собеседника в этом диалоге (Telegram). */
  readonly counterpartyUsername?: string | null
  /** Собственный числовой id собеседника в этом диалоге (Telegram). */
  readonly counterpartyTelegramId?: string | null
  readonly counterpartyEmail?: string | null
  readonly counterpartyPhone?: string | null
  readonly channel?: "hh" | "telegram" | "mail"
}

export interface AttributedContact {
  readonly kind: IdentityKind
  readonly value: string
  readonly attribution: Attribution
  readonly confidence: number
  readonly raw: string
  readonly url: string | null
  readonly evidence: string
  readonly personName: string | null
  readonly personRole: string | null
}

/** Слова, по которым автор называет контакт своим. */
const SELF_MARKERS = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    [
      "мой",
      "моя",
      "моё",
      "мое",
      "мои",
      "моим",
      "моего",
      "мне",
      "мною",
      "звоните",
      "звони",
      "(?:на|нап)?пишите\\s+мне",
      "пиши\\s+мне",
      "писать\\s+мне",
      "my",
      "(?:contact|call|text|message|reach|write\\s+to)\\s+me"
    ].join("|") +
    ")(?![\\p{L}\\p{N}])",
  "iu"
)

/** Слова рядом с контактом, после которых он чужой: «его телеграм», «контакт коллеги». */
const OTHER_MARKERS =
  /(?<![\p{L}\p{N}])(?:его|её|ее|их|коллег\p{L}*|his|her|their)(?![\p{L}\p{N}])/iu

const WINDOW_BEFORE = 80
const WINDOW_AFTER = 20

const isSelfReference = (text: string, raw: string): boolean => {
  const at = text.indexOf(raw)
  if (at < 0) return false

  const lastChunk = (value: string): string => value.split(/\n\s*\n/).pop() ?? ""
  const before = lastChunk(text.slice(Math.max(0, at - WINDOW_BEFORE), at))
  const after = (text.slice(at + raw.length, at + raw.length + WINDOW_AFTER).split(/\n\s*\n/)[0]) ?? ""

  if (OTHER_MARKERS.test(before.slice(-50))) return false
  return SELF_MARKERS.test(before) || SELF_MARKERS.test(after)
}

const isIdentityKind = (kind: string): kind is IdentityKind =>
  kind === "email" || kind === "phone" || kind === "telegram" || kind === "telegram_id"

const RANK: Record<Attribution, number> = { counterparty: 1, mentioned: 0 }

/**
 * Разбирает переписку и решает, кто хозяин каждого найденного контакта.
 *
 * - Контакт в исходящем сообщении — это «свой» контакт соискателя, он
 *   отбрасывается.
 * - Контакт во входящем сообщении — `counterparty` (≥ 0.85), если рядом есть
 *   самоуказание («мой тг», «пишите мне», «звоните») или он совпадает с
 *   собственным username/id собеседника по диалогу; иначе — `mentioned` (≤ 0.5).
 * - Боты и ссылки-приглашения человеку не принадлежат и в результат не попадают.
 * - Собственные идентичности диалога из `ctx` добавляются как `counterparty`
 *   с уверенностью 1.
 */
export const attributeCandidates = (
  messages: ReadonlyArray<AttributionMessage>,
  ctx: AttributionContextInput = {}
): ReadonlyArray<AttributedContact> => {
  const dialogKeys = new Set<string>()
  const result = new Map<string, AttributedContact>()

  const put = (item: AttributedContact): void => {
    const key = identityKey(item.kind, item.value)
    const previous = result.get(key)
    if (
      previous === undefined ||
      RANK[item.attribution] > RANK[previous.attribution] ||
      (RANK[item.attribution] === RANK[previous.attribution] &&
        item.confidence > previous.confidence)
    ) {
      result.set(key, item)
    }
  }

  const dialog = (kind: IdentityKind, value: string | null | undefined): void => {
    if (value === null || value === undefined || value.trim() === "") return
    const normalized = normalizeIdentity(kind, value)
    dialogKeys.add(`${kind}:${normalized}`)
    put({
      kind,
      value: normalized,
      attribution: "counterparty",
      confidence: DIALOG_CONFIDENCE,
      raw: value,
      url: null,
      evidence: "dialog",
      personName: ctx.counterpartyName ?? null,
      personRole: null
    })
  }

  dialog("telegram", ctx.counterpartyUsername)
  dialog("telegram_id", ctx.counterpartyTelegramId)
  dialog("email", ctx.counterpartyEmail)
  dialog("phone", ctx.counterpartyPhone)

  for (const message of messages) {
    // Контакт в своём сообщении — свой, а не собеседника.
    if (message.direction !== "in" || message.text === null) continue
    const text = message.text.replace(/ /g, " ")

    const extraction = extractContactsFromText(text, {
      senderName: ctx.counterpartyName ?? null,
      channel: ctx.channel
    })

    for (const contact of extraction.contacts) {
      if (!isIdentityKind(contact.kind) || contact.isBot) continue
      if (contact.kind === "telegram" && /^https?:\/\//iu.test(contact.value)) continue

      const value = normalizeIdentity(contact.kind, contact.value)
      const own = dialogKeys.has(`${contact.kind}:${value}`) || isSelfReference(text, contact.raw)

      put({
        kind: contact.kind,
        value,
        attribution: own ? "counterparty" : "mentioned",
        confidence: own ? COUNTERPARTY_CONFIDENCE : MENTIONED_CONFIDENCE,
        raw: contact.raw,
        url: contact.url,
        evidence: contact.evidence,
        personName: contact.personName,
        personRole: contact.personRole
      })
    }
  }

  return [...result.values()]
}

/* -------------------------------------------------------------------------- */
/* excludeOwn                                                                 */
/* -------------------------------------------------------------------------- */

export interface OwnIdentities {
  readonly emails?: ReadonlyArray<string>
  readonly phones?: ReadonlyArray<string>
  readonly telegramUsernames?: ReadonlyArray<string>
  readonly telegramIds?: ReadonlyArray<string>
}

/** Убирает идентичности самого соискателя: свой телефон не контакт рекрутера. */
export const excludeOwn = <T extends { readonly kind: string; readonly value: string }>(
  candidates: ReadonlyArray<T>,
  own: OwnIdentities
): ReadonlyArray<T> => {
  const keys = new Set<string>()
  for (const value of own.emails ?? []) keys.add(identityKey("email", value))
  for (const value of own.phones ?? []) keys.add(identityKey("phone", value))
  for (const value of own.telegramUsernames ?? []) keys.add(identityKey("telegram", value))
  for (const value of own.telegramIds ?? []) keys.add(identityKey("telegram_id", value))

  return candidates.filter((candidate) => !keys.has(identityKey(candidate.kind, candidate.value)))
}

/* -------------------------------------------------------------------------- */
/* resolvePerson                                                              */
/* -------------------------------------------------------------------------- */

export interface ResolveIdentity {
  readonly kind: string
  readonly value: string
  readonly attribution: Attribution
  readonly confidence: number
}

export interface ExistingContact {
  readonly kind: string
  readonly value: string
  readonly personId: string | null
}

export interface ResolvePersonInput {
  /** Идентичности одного диалога. */
  readonly identities: ReadonlyArray<ResolveIdentity>
  /** Уже сохранённые контакты с теми же ключами. */
  readonly existing: ReadonlyArray<ExistingContact>
}

export interface IdentityLink {
  readonly kind: string
  readonly value: string
  readonly personLink: "auto" | "suggested"
}

export interface MergeSuggestion {
  readonly a: string
  readonly b: string
  readonly reason: string
}

export interface PersonResolution {
  readonly action: "create" | "attach" | "none"
  readonly personId?: string
  readonly identityLinks: ReadonlyArray<IdentityLink>
  readonly mergeSuggestions: ReadonlyArray<MergeSuggestion>
}

const NONE: PersonResolution = { action: "none", identityLinks: [], mergeSuggestions: [] }

/**
 * Решает, какому человеку принадлежит диалог.
 *
 * - Создавать человека и привязывать к нему автоматически могут только
 *   `counterparty`-идентичности с уверенностью ≥ 0.8.
 * - `mentioned`-идентичности становятся `suggested`, и только если ещё никому не
 *   принадлежат: чужой контакт не отбирается.
 * - Если сильные идентичности указывают на разных людей, слияния нет: вернутся
 *   только `mergeSuggestions`. Сам по себе человека однозначно определяют
 *   совпавшие email, телефон или telegram_id; совпадение по @username — слабее и
 *   порождает лишь предложение, если расходится с надёжным.
 */
export const resolvePerson = (input: ResolvePersonInput): PersonResolution => {
  const owners = new Map<string, string>()
  for (const contact of input.existing) {
    if (contact.personId !== null) {
      owners.set(identityKey(contact.kind, contact.value), contact.personId)
    }
  }

  // Одна идентичность — одна запись; counterparty сильнее mentioned.
  const byKey = new Map<string, ResolveIdentity & { key: string }>()
  for (const identity of input.identities) {
    const key = identityKey(identity.kind, identity.value)
    const entry = {
      ...identity,
      value: normalizeIdentity(identity.kind, identity.value),
      key
    }
    const previous = byKey.get(key)
    if (
      previous === undefined ||
      RANK[entry.attribution] > RANK[previous.attribution] ||
      (RANK[entry.attribution] === RANK[previous.attribution] &&
        entry.confidence > previous.confidence)
    ) {
      byKey.set(key, entry)
    }
  }

  const strong = [...byKey.values()].filter(
    (identity) =>
      identity.attribution === "counterparty" && identity.confidence >= AUTO_LINK_CONFIDENCE
  )
  const weak = [...byKey.values()].filter((identity) => !strong.includes(identity))
  if (strong.length === 0) return NONE

  // Люди, найденные по надёжным и по слабым ключам.
  const sure = new Map<string, ResolveIdentity>()
  const soft = new Map<string, ResolveIdentity>()
  for (const identity of strong) {
    const owner = owners.get(identity.key)
    if (owner === undefined) continue
    const bucket = SURE_KINDS.has(identity.kind) ? sure : soft
    if (!bucket.has(owner)) bucket.set(owner, identity)
  }
  for (const owner of sure.keys()) soft.delete(owner)

  const describe = (identity: ResolveIdentity): string => `${identity.kind} ${identity.value}`
  const suggestions: Array<MergeSuggestion> = []
  const suggest = (left: string, right: string, reason: string): void => {
    const [a, b] = left < right ? [left, right] : [right, left]
    if (!suggestions.some((item) => item.a === a && item.b === b)) {
      suggestions.push({ a, b, reason })
    }
  }

  const sureIds = [...sure.keys()]
  const softIds = [...soft.keys()]

  let target: string | undefined
  if (sureIds.length >= 2) {
    for (let i = 0; i < sureIds.length; i++) {
      for (let j = i + 1; j < sureIds.length; j++) {
        suggest(
          sureIds[i]!,
          sureIds[j]!,
          `в одном диалоге: ${describe(sure.get(sureIds[i]!)!)} и ${describe(sure.get(sureIds[j]!)!)}`
        )
      }
    }
    return { action: "none", identityLinks: [], mergeSuggestions: suggestions }
  }
  if (sureIds.length === 1) {
    target = sureIds[0]
    for (const other of softIds) {
      suggest(target!, other, `тот же диалог связывает ${describe(soft.get(other)!)}`)
    }
  } else if (softIds.length >= 2) {
    for (let i = 0; i < softIds.length; i++) {
      for (let j = i + 1; j < softIds.length; j++) {
        suggest(
          softIds[i]!,
          softIds[j]!,
          `в одном диалоге: ${describe(soft.get(softIds[i]!)!)} и ${describe(soft.get(softIds[j]!)!)}`
        )
      }
    }
    return { action: "none", identityLinks: [], mergeSuggestions: suggestions }
  } else if (softIds.length === 1) {
    target = softIds[0]
  }

  const links: Array<IdentityLink> = []
  for (const identity of strong) {
    const owner = owners.get(identity.key)
    if (owner === undefined || owner === target) {
      links.push({ kind: identity.kind, value: identity.value, personLink: "auto" })
    }
  }
  for (const identity of weak) {
    if (!owners.has(identity.key)) {
      links.push({ kind: identity.kind, value: identity.value, personLink: "suggested" })
    }
  }

  return target === undefined
    ? { action: "create", identityLinks: links, mergeSuggestions: suggestions }
    : { action: "attach", personId: target, identityLinks: links, mergeSuggestions: suggestions }
}

/* -------------------------------------------------------------------------- */
/* rankVacancyLinks                                                           */
/* -------------------------------------------------------------------------- */

export type VacancyLinkSignalKind =
  | "hh_chat"
  | "url_in_text"
  | "contact_in_vacancy"
  | "person_inference"

export interface VacancyLinkSignal {
  readonly vacancyId: string
  readonly kind: VacancyLinkSignalKind
}

export interface VacancyLink {
  readonly vacancyId: string
  readonly kind: "primary" | "mentioned" | "candidate"
  readonly confidence: number
  /** Сигнал, который дал эту уверенность. */
  readonly source: VacancyLinkSignalKind
}

const SIGNAL_CONFIDENCE: Record<VacancyLinkSignalKind, number> = {
  hh_chat: 1,
  url_in_text: 1,
  contact_in_vacancy: 0.9,
  person_inference: 0.4
}

/** При равной уверенности побеждает более прямой сигнал. */
const SIGNAL_ORDER: ReadonlyArray<VacancyLinkSignalKind> = [
  "hh_chat",
  "url_in_text",
  "contact_in_vacancy",
  "person_inference"
]

/**
 * Сводит сигналы о вакансиях диалога к связям. Вывод по человеку
 * (`person_inference`) всегда только кандидат; единственная `primary` — вакансия
 * с самой высокой уверенностью среди не-кандидатов.
 */
export const rankVacancyLinks = (
  signals: ReadonlyArray<VacancyLinkSignal>
): ReadonlyArray<VacancyLink> => {
  const best = new Map<string, VacancyLinkSignalKind>()
  const direct = new Map<string, VacancyLinkSignalKind>()

  const better = (left: VacancyLinkSignalKind, right: VacancyLinkSignalKind): boolean =>
    SIGNAL_ORDER.indexOf(left) < SIGNAL_ORDER.indexOf(right)

  for (const signal of signals) {
    const target = signal.kind === "person_inference" ? best : direct
    const previous = target.get(signal.vacancyId)
    if (previous === undefined || better(signal.kind, previous)) {
      target.set(signal.vacancyId, signal.kind)
    }
  }

  const links: Array<VacancyLink> = []
  for (const [vacancyId, source] of direct) {
    links.push({ vacancyId, kind: "mentioned", confidence: SIGNAL_CONFIDENCE[source], source })
  }
  // Порядок вставки стабилен: сортировка сохраняет его для равных.
  links.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      SIGNAL_ORDER.indexOf(left.source) - SIGNAL_ORDER.indexOf(right.source)
  )
  const primary = links[0]
  if (primary !== undefined) links[0] = { ...primary, kind: "primary" }

  for (const [vacancyId, source] of best) {
    if (direct.has(vacancyId)) continue
    links.push({ vacancyId, kind: "candidate", confidence: SIGNAL_CONFIDENCE[source], source })
  }

  return links
}

/* -------------------------------------------------------------------------- */
/* rankResumeLinks                                                            */
/* -------------------------------------------------------------------------- */

export interface VacancyApplication {
  readonly vacancyId: string
  readonly resumeId: string
  readonly hhAccountId: string
}

export interface AccountResume {
  readonly resumeId: string
  readonly hhAccountId: string
  readonly active: boolean
}

export interface ResumeLinkInput {
  /** Отклики по вакансиям диалога. */
  readonly vacancyApplications: ReadonlyArray<VacancyApplication>
  /** Вакансии диалога; если не заданы, учитываются все отклики. */
  readonly vacancyIds?: ReadonlyArray<string>
  /** Аккаунты hh, привязанные к Telegram-аккаунту диалога. */
  readonly telegramHhAccountIds: ReadonlyArray<string>
  /** Резюме аккаунтов hh, нужны для вывода без откликов. */
  readonly accountResumes?: ReadonlyArray<AccountResume>
  /** Резюме точно известно из чата hh. */
  readonly hhChatResumeId?: string | null
}

export interface ResumeLink {
  readonly resumeId: string
  readonly confidence: number
  readonly source: "hh_chat" | "tg_vacancy_account" | "vacancy_application" | "tg_account"
}

/**
 * Определяет резюме диалога.
 *
 * 1. Чат hh знает резюме точно: 1.0.
 * 2. Диалог в Telegram о вакансии V: отклики на V, пересечённые с резюме
 *    аккаунтов hh, привязанных к Telegram, дают единственное резюме с 0.9;
 *    иначе единственное резюме среди откликов на V даёт 0.7.
 * 3. Откликов на V нет, но Telegram привязан ровно к одному аккаунту hh с
 *    ровно одним активным резюме: 0.4.
 * Неоднозначность даёт пустой результат: лучше без связи, чем с неверной.
 */
export const rankResumeLinks = (input: ResumeLinkInput): ReadonlyArray<ResumeLink> => {
  if (input.hhChatResumeId !== undefined && input.hhChatResumeId !== null) {
    return [{ resumeId: input.hhChatResumeId, confidence: 1, source: "hh_chat" }]
  }

  const scope = input.vacancyIds === undefined ? undefined : new Set(input.vacancyIds)
  const applications = input.vacancyApplications.filter(
    (item) => scope === undefined || scope.has(item.vacancyId)
  )

  if (applications.length > 0) {
    const accounts = new Set(input.telegramHhAccountIds)
    const linked = new Set(
      applications.filter((item) => accounts.has(item.hhAccountId)).map((item) => item.resumeId)
    )
    if (linked.size === 1) {
      return [{ resumeId: [...linked][0]!, confidence: 0.9, source: "tg_vacancy_account" }]
    }

    const all = new Set(applications.map((item) => item.resumeId))
    if (all.size === 1) {
      return [{ resumeId: [...all][0]!, confidence: 0.7, source: "vacancy_application" }]
    }
    return []
  }

  const accountIds = new Set(input.telegramHhAccountIds)
  if (accountIds.size !== 1) return []
  const [accountId] = [...accountIds]
  const active = (input.accountResumes ?? []).filter(
    (item) => item.hhAccountId === accountId && item.active
  )
  const distinct = new Set(active.map((item) => item.resumeId))
  if (distinct.size !== 1) return []
  return [{ resumeId: [...distinct][0]!, confidence: 0.4, source: "tg_account" }]
}
