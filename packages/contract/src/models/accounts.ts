import { Schema } from "effect"
import { HhAccountId, MailAccountId, TelegramAccountId } from "../ids.ts"

export const MailAccountRecord = Schema.Struct({
  id: MailAccountId,
  label: Schema.String,
  address: Schema.String,
  host: Schema.String,
  port: Schema.Int,
  secure: Schema.Boolean,
  username: Schema.String,
  includeSent: Schema.Boolean,
  backfillDays: Schema.Int,
  status: Schema.String,
  enabled: Schema.Boolean,
  lastSyncAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type MailAccountRecord = typeof MailAccountRecord.Type

export const TelegramAccountRecord = Schema.Struct({
  id: TelegramAccountId,
  label: Schema.String,
  tgUserId: Schema.NullOr(Schema.String),
  username: Schema.NullOr(Schema.String),
  phoneMasked: Schema.NullOr(Schema.String),
  status: Schema.String,
  enabled: Schema.Boolean,
  lastSyncAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type TelegramAccountRecord = typeof TelegramAccountRecord.Type

export const HhSessionState = Schema.Literals(["ok", "expired", "blocked"])
export type HhSessionState = typeof HhSessionState.Type

/** Health of one account's hh.ru login. Cookies never leave the operator's disk. */
export const HhSessionRecord = Schema.Struct({
  state: HhSessionState,
  lastOkAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: Schema.String
})
export type HhSessionRecord = typeof HhSessionRecord.Type

/** Собственные контакты аккаунта из блока «Контакты» профиля hh; только чтение. */
export const HhAccountContacts = Schema.Struct({
  phone: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  telegram: Schema.NullOr(Schema.String)
})
export type HhAccountContacts = typeof HhAccountContacts.Type

export const HhAccountRecord = Schema.Struct({
  id: HhAccountId,
  label: Schema.String,
  isDefault: Schema.Boolean,
  sessionProfile: Schema.NullOr(Schema.String),
  firstName: Schema.optional(Schema.NullOr(Schema.String)),
  lastName: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  /** Operator-chosen colour, `#rrggbb`; null/absent means the automatic colour. */
  color: Schema.optional(Schema.NullOr(Schema.String)),
  session: Schema.optional(Schema.NullOr(HhSessionRecord)),
  contacts: Schema.optional(Schema.NullOr(HhAccountContacts)),
  /**
   * Отправки аккаунта остановлены с этого момента (hh показал капчу); null -
   * не остановлены. Снимает оператор (`HhAccountSubmitResume`).
   */
  submitBlockedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Почему остановлены: `captcha`. */
  submitBlockReason: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type HhAccountRecord = typeof HhAccountRecord.Type

/** Outcome of one bounded source sync; counters, never row dumps. */
export const SyncResult = Schema.Struct({
  processed: Schema.Int,
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  contacts: Schema.Int,
  linked: Schema.Int,
  errors: Schema.Array(Schema.String)
})

export type SyncResult = typeof SyncResult.Type

/** Status of a detached QR login, polled by the CLI. */
export const TelegramLoginStatusValue = Schema.Literals([
  "idle",
  "pending",
  "authorized",
  "error"
])

export type TelegramLoginStatusValue = typeof TelegramLoginStatusValue.Type

/* -------------------------------------------------------------------------- */
