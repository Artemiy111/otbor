import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import {
  CaptchaSolverSettings,
  CaptchaSolverTestResult,
  LocalModelHealth,
  LocalModelInput,
  LocalModelServer
} from "../models/index.ts"

/** Сохранённые локальные серверы моделей (без ключей). */
export const LocalModelsList = Rpc.make("LocalModelsList", {
  success: Schema.Array(LocalModelServer),
  error: ApiError
})

/** Добавляет или заменяет сервер в `~/.otbor/openai.json` (0600). */
export const LocalModelUpsert = Rpc.make("LocalModelUpsert", {
  payload: LocalModelInput,
  success: Schema.Array(LocalModelServer),
  error: ApiError
})

export const LocalModelRemove = Rpc.make("LocalModelRemove", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Array(LocalModelServer),
  error: ApiError
})

/** Проверяет все сохранённые серверы: отвечает ли `/models` и сколько там моделей. */
export const LocalModelsCheck = Rpc.make("LocalModelsCheck", {
  success: Schema.Array(LocalModelHealth),
  error: ApiError
})

/** Какой моделью читать капчу hh. */
export const CaptchaSolverGet = Rpc.make("CaptchaSolverGet", {
  success: CaptchaSolverSettings,
  error: ApiError
})

export const CaptchaSolverSet = Rpc.make("CaptchaSolverSet", {
  payload: CaptchaSolverSettings,
  success: CaptchaSolverSettings,
  error: ApiError
})

/** Прогоняет сохранённую модель по последней картинке капчи и возвращает прочитанный текст. */
export const CaptchaSolverTest = Rpc.make("CaptchaSolverTest", {
  success: CaptchaSolverTestResult,
  error: ApiError
})
