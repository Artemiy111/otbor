import type { RunnerExit, JobKind } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import {
  type EnqueueInferenceInput,
  InferenceService
} from "../../../src/services/InferenceService.ts"
import { QueueService } from "../../../src/services/QueueService.ts"
import { runAs, runAsFailure } from "./layers.ts"
import { ownerTx, unique } from "./seeds.ts"

export const registerRunner = async (
  userId: string,
  accounts: ReadonlyArray<string>,
  name = unique("runner"),
  kinds: ReadonlyArray<JobKind> = ["browser"]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.register({ name, kinds, accounts })
    })
  )

export const leaseNext = async (
  userId: string,
  runnerId: string,
  token: string,
  accounts: ReadonlyArray<string>,
  kinds: ReadonlyArray<JobKind> = ["browser"]
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.leaseNext({ runnerId, token, kinds, accounts })
    })
  )

export const revokeRunner = async (userId: string, runnerId: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.revoke({ runnerId })
    })
  )

export const heartbeatJob = async (
  userId: string,
  input: { runnerId: string; token: string; jobId: string; leaseId: string; epoch: number }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.heartbeat(input)
    })
  )

export const completeJob = async (
  userId: string,
  input: {
    runnerId: string
    token: string
    jobId: string
    leaseId: string
    epoch: number
    exit: RunnerExit
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.complete(input)
    })
  )

export const completeJobFailure = async (
  userId: string,
  input: {
    runnerId: string
    token: string
    jobId: string
    leaseId: string
    epoch: number
    exit: RunnerExit
  }
) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const queue = yield* QueueService
      return yield* queue.complete(input)
    })
  )

export const enqueueInference = async (userId: string, input: EnqueueInferenceInput) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.enqueue(input)
    })
  )

export const getInference = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.get(id)
    })
  )

export const getInferenceFailure = async (userId: string, id: string) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const inference = yield* InferenceService
      return yield* inference.get(id)
    })
  )

export interface RawJobInput {
  readonly userId: string
  readonly stage: string
  readonly kind?: string
  /** Written to the `result` column; omitted leaves it null. */
  readonly result?: unknown
}

/**
 * Inserts straight into `runner_jobs`, bypassing the repositories and their
 * defaults. This is how the migration's stage check and the `result` column are
 * exercised without a service in between.
 */
const rawJobInsert = (input: RawJobInput) =>
  ownerTx((tx) =>
    tx
      .execute(sql`
        insert into runner_jobs (user_id, stage, kind, payload, result, idempotency_key)
        values (
          ${input.userId},
          ${input.stage},
          ${input.kind ?? "inference"},
          '{}'::jsonb,
          ${input.result === undefined ? null : JSON.stringify(input.result)}::jsonb,
          ${unique("raw-job")}
        )
        returning id
      `)
      .pipe(Effect.map((result) => (result.rows[0] as { id: string }).id))
  )

export const insertRawJob = async (input: RawJobInput) => runAs(input.userId, rawJobInsert(input))

export const insertRawJobFailure = async (input: RawJobInput) =>
  runAsFailure(input.userId, rawJobInsert(input))
