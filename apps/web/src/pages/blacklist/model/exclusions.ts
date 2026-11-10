import type { BlacklistRecord, BlacklistScope, BlacklistTarget } from "@otbor/contract"
import { companyPath, vacancyPath } from "@/shared/lib"

/** Строка таблицы: одна цель, скрытая сразу несколькими аккаунтами, это одна строка. */
export interface ExclusionRow extends BlacklistRecord {
  /** Все записи, которые «Вернуть» удалит вместе. */
  readonly ids: ReadonlyArray<string>
  readonly accountIds: ReadonlyArray<string>
}

export const targetLabel = (type: BlacklistTarget): string => (type === "vacancy" ? "Вакансия" : "Работодатель")

/** Где правило действует, коротко; конкретный аккаунт или резюме добавляет интерфейс. */
export const scopeLabel = (scope: BlacklistScope): string => {
  switch (scope) {
    case "app":
      return "Для всех аккаунтов"
    case "hh_account":
      return "Для аккаунта"
    case "resume":
      return "Для резюме"
    case "hh_native":
      return "Скрыто на hh.ru"
  }
}

/**
 * Кто создал запись. Сервер различает кнопку «Отбраковать» (`reject`) и ручную
 * форму (`user`). Строки слоёв «все аккаунты» и «аккаунт» до миграции 0062 писались
 * одинаково, поэтому у вакансии с `user` честно сказано: вручную или старая отбраковка.
 * Слой резюме раньше создавался только кнопкой, его миграция уже пометила.
 */
export const originLabel = (record: Pick<BlacklistRecord, "source" | "scope" | "targetType">): string => {
  if (record.source === "hh_hidden") return "Импорт с hh"
  if (record.source === "reject") return "Кнопка «Отбраковать»"
  if (record.scope === "resume") return "Кнопка «Отбраковать»"
  if (record.targetType === "vacancy") return "Вручную (или отбраковка до обновления)"
  return "Вручную"
}

/** Внутренняя страница цели в otbor, если она есть в базе. */
export const internalPath = (record: Pick<BlacklistRecord, "targetType" | "vacancyId" | "employerId">): string | null => {
  if (record.targetType === "vacancy") return record.vacancyId == null ? null : vacancyPath(record.vacancyId)
  return record.employerId == null ? null : companyPath(record.employerId)
}

/** Группа записей, которые для человека одно исключение. */
const groupKey = (item: BlacklistRecord): string =>
  [item.scope, item.targetType, item.externalId, item.scope === "resume" ? (item.resumeId ?? "") : ""].join(":")

/** Склеивает одну и ту же цель, скрытую несколькими аккаунтами, в одну строку. */
export const groupExclusions = (items: ReadonlyArray<BlacklistRecord>): ReadonlyArray<ExclusionRow> => {
  const groups = new Map<string, ExclusionRow>()
  for (const item of items) {
    const key = groupKey(item)
    const prev = groups.get(key)
    const account = item.hhAccountId ?? null
    if (prev === undefined) {
      groups.set(key, { ...item, ids: [item.id], accountIds: account === null ? [] : [account] })
      continue
    }
    groups.set(key, {
      ...prev,
      ids: [...prev.ids, item.id],
      accountIds: account === null || prev.accountIds.includes(account) ? prev.accountIds : [...prev.accountIds, account],
      updatedAt: item.updatedAt > prev.updatedAt ? item.updatedAt : prev.updatedAt
    })
  }
  return [...groups.values()]
}

/**
 * Как снять запись. Отбраковка вакансии снимается отдельным вызовом: он заново
 * решает вакансию и возвращает остановленные заявки. Остальное просто удаляется.
 */
export const removalKind = (row: Pick<ExclusionRow, "scope" | "targetType">): "unreject" | "remove" =>
  row.targetType === "vacancy" && row.scope !== "hh_native" ? "unreject" : "remove"

/** Ссылка на цель на hh.ru. */
export const hhUrl = (type: BlacklistTarget, externalId: string): string =>
  `https://hh.ru/${type === "vacancy" ? "vacancy" : "employer"}/${encodeURIComponent(externalId)}`

/** Из вставленной ссылки hh.ru получает тип и номер; обычный номер считается номером как есть. */
export const parseHhTarget = (input: string): { type: BlacklistTarget | null; externalId: string } => {
  const text = input.trim()
  const match = /hh\.[a-z]+\/(vacancy|employer)\/(\d+)/i.exec(text)
  if (match) return { type: match[1]!.toLowerCase() === "vacancy" ? "vacancy" : "employer", externalId: match[2]! }
  return { type: null, externalId: text }
}
