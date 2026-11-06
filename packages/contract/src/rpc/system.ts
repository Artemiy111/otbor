import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { Health } from "../models/index.ts"

export const SystemHealth = Rpc.make("SystemHealth", {
  success: Health,
  error: ApiError
})
