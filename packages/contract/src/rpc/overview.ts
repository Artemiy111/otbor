import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { Overview } from "../models/index.ts"

/**
 * Снимок для главной страницы: отклики, воронка, аккаунты, очередь, входящие и
 * лента событий. `days` - окно в сутках (по умолчанию 14, от 1 до 60).
 */
export const OverviewGet = Rpc.make("OverviewGet", {
  payload: Schema.Struct({ days: Schema.optional(Schema.Int) }),
  success: Overview,
  error: ApiError
})
