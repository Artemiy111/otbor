import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { ApiError } from "../errors.ts"
import { HhAccountId } from "../ids.ts"
import { NegotiationsSyncStatus, ResumeSyncStatus } from "../models/index.ts"

/**
 * Reads the account's negotiations list from hh.ru and imports responses made
 * by hand. `NegotiationsSyncRun` only enqueues the browser job (it never waits
 * for hh.ru); `NegotiationsSyncStatus` reads the last job's outcome.
 */
export const NegotiationsSyncRun = Rpc.make("NegotiationsSyncRun", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: NegotiationsSyncStatus,
  error: ApiError
})

export const NegotiationsSyncStatusGet = Rpc.make("NegotiationsSyncStatus", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: NegotiationsSyncStatus,
  error: ApiError
})

/**
 * Reads the account's resumes from hh.ru into the corpus. `ResumeSyncRun` only
 * enqueues the browser job (it never waits for hh.ru); `ResumeSyncStatusGet`
 * reads the last job's outcome.
 */
export const ResumeSyncRun = Rpc.make("ResumeSyncRun", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: ResumeSyncStatus,
  error: ApiError
})

export const ResumeSyncStatusGet = Rpc.make("ResumeSyncStatus", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: ResumeSyncStatus,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
