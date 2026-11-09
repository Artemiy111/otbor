import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HhAccountId } from "../ids.ts"
import { CaptchaEpisode, CaptchaModelStat, CaptchaSolveRecord, HhAccountRecord, HhSessionState } from "../models/index.ts"

export const HhAccountsList = Rpc.make("HhAccountsList", {
  success: Schema.Array(HhAccountRecord),
  error: ApiError
})

export const HhAccountUpsert = Rpc.make("HhAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(HhAccountId),
    label: Schema.String,
    isDefault: Schema.optional(Schema.Boolean),
    sessionProfile: Schema.optional(Schema.NullOr(Schema.String)),
    firstName: Schema.optional(Schema.NullOr(Schema.String)),
    lastName: Schema.optional(Schema.NullOr(Schema.String)),
    areaName: Schema.optional(Schema.NullOr(Schema.String)),
    /** `#rrggbb`, or null to go back to the automatic colour. */
    color: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountSessionSet = Rpc.make("HhAccountSessionSet", {
  payload: Schema.Struct({
    id: HhAccountId,
    state: HhSessionState,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountRemove = Rpc.make("HhAccountRemove", {
  payload: Schema.Struct({ id: HhAccountId }),
  success: Schema.Struct({ id: HhAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

/**
 * Оператор решил капчу в профиле браузера: снимает блокировку отправок
 * аккаунта и возвращает автозаявки, ждавшие капчу, раннеру.
 */
export const HhAccountSubmitResume = Rpc.make("HhAccountSubmitResume", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: Schema.Struct({
    account: HhAccountRecord,
    /** Сколько автозаявок снова доступны раннеру. */
    released: Schema.Int
  }),
  error: ApiError
})

/** Последние эпизоды капчи, новые первыми: после скольких откликов hh её показывает. */
export const HhCaptchaEpisodesList = Rpc.make("HhCaptchaEpisodesList", {
  payload: Schema.Struct({
    hhAccountId: Schema.optional(HhAccountId),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(CaptchaEpisode),
  error: ApiError
})

/**
 * Журнал распознавания капчи: последние капчи (модель, число попыток, решена ли)
 * и сводка по моделям. Сохраняется облаком из отчёта харнеса.
 */
export const CaptchaSolvesList = Rpc.make("CaptchaSolvesList", {
  payload: Schema.Struct({
    hhAccountId: Schema.optional(HhAccountId),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    solves: Schema.Array(CaptchaSolveRecord),
    models: Schema.Array(CaptchaModelStat)
  }),
  error: ApiError
})

/**
 * Cookies аккаунта (Playwright storageState как JSON-текст). Оператор читает и
 * пишет их из CLI: `otbor hh login` кладёт сюда результат входа.
 */
export const HhAccountSessionStateGet = Rpc.make("HhAccountSessionStateGet", {
  payload: Schema.Struct({ id: HhAccountId }),
  success: Schema.Struct({
    state: Schema.NullOr(Schema.String),
    version: Schema.NullOr(Schema.Int),
    updatedAt: Schema.NullOr(Schema.String)
  }),
  error: ApiError
})

export const HhAccountSessionStatePut = Rpc.make("HhAccountSessionStatePut", {
  payload: Schema.Struct({ id: HhAccountId, state: Schema.String }),
  success: Schema.Struct({ version: Schema.Int }),
  error: ApiError
})
