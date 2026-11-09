import { Schema } from "effect"
import { HhAccountId } from "../ids.ts"
import { HhSessionRecord } from "./accounts.ts"

export const HealthAccount = Schema.Struct({
  id: HhAccountId,
  label: Schema.String,
  sessionProfile: Schema.NullOr(Schema.String),
  session: Schema.NullOr(HhSessionRecord)
})
export type HealthAccount = typeof HealthAccount.Type

/** A browser or inference harness and whether it has polled in the last two minutes. */
export const HealthHarness = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kinds: Schema.Array(Schema.String),
  accounts: Schema.Array(HhAccountId),
  lastSeenAt: Schema.NullOr(Schema.String),
  online: Schema.Boolean
})
export type HealthHarness = typeof HealthHarness.Type

/** Локальная модель анализа вакансий (SystemOne): отвечает ли сервер прямо сейчас. */
export const HealthSystemOne = Schema.Struct({
  reachable: Schema.Boolean,
  endpoint: Schema.String,
  model: Schema.String,
  latencyMs: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String)
})
export type HealthSystemOne = typeof HealthSystemOne.Type

export const Health = Schema.Struct({
  status: Schema.Literals(["ok", "degraded"]),
  version: Schema.String,
  database: Schema.Boolean,
  now: Schema.String,
  accounts: Schema.optional(Schema.Array(HealthAccount)),
  harnesses: Schema.optional(Schema.Array(HealthHarness)),
  systemOne: Schema.optional(HealthSystemOne)
})

export type Health = typeof Health.Type
