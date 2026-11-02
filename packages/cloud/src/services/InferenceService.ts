import type { ApiError, HarnessJob, InferencePayload, HhAccountId } from "@otbor/contract"
import { InvalidInput, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { inferenceJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

export interface EnqueueInferenceInput {
  readonly prompt: string
  readonly system?: string
  readonly model?: string
  readonly jsonSchema?: unknown
  readonly hhAccountId?: HhAccountId
}

export interface InferenceServiceShape {
  readonly enqueue: (
    input: EnqueueInferenceInput
  ) => Effect.Effect<{ readonly job: HarnessJob }, ApiError>
  readonly get: (id: string) => Effect.Effect<HarnessJob, ApiError>
}

const accountFor = (tx: Executor, userId: string) =>
  tx
    .execute(sql`
      select id from hh_account
      where user_id = ${userId}
      order by is_default desc, created_at asc
      limit 1
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null))

const accountExists = (tx: Executor, id: string) =>
  tx
    .execute(sql`select id from hh_account where id = ${id} limit 1`)
    .pipe(Effect.map((result) => result.rows.length > 0))

/**
 * The cloud-side half of ACP: enqueue a prompt and read the result. The actual
 * agent process lives on the inference harness, never in the server.
 */
export class InferenceService extends Context.Service<InferenceService, InferenceServiceShape>()(
  "otbor/cloud/InferenceService"
) {
  static readonly layer = Layer.effect(
    InferenceService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const enqueue: InferenceServiceShape["enqueue"] = (input) =>
        Effect.gen(function*() {
          if (input.prompt.trim() === "") {
            return yield* new InvalidInput({ message: "inference prompt must not be empty" })
          }

          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                let hhAccountId: string | null = input.hhAccountId ?? null
                if (hhAccountId !== null && !(yield* accountExists(tx, hhAccountId))) {
                  return { _tag: "missing" as const }
                }
                if (hhAccountId === null) {
                  hhAccountId = yield* accountFor(tx, currentUser.userId)
                }

                const payload: InferencePayload = {
                  prompt: input.prompt,
                  ...(input.system === undefined ? {} : { system: input.system }),
                  ...(input.model === undefined ? {} : { model: input.model }),
                  ...(input.jsonSchema === undefined ? {} : { jsonSchema: input.jsonSchema })
                }

                const job = yield* inferenceJob(tx, {
                  userId: currentUser.userId,
                  hhAccountId,
                  payload,
                  idempotencyKey: `inference:${currentUser.userId}:${randomUUID()}`
                })
                return { _tag: "ok" as const, job }
              })
            )
            .pipe(Effect.mapError(toStorageError("inference.enqueue")))

          if (outcome._tag === "missing") {
            return yield* new NotFound({ entity: "HhAccount", id: input.hhAccountId ?? "" })
          }
          return { job: outcome.job }
        })

      const get: InferenceServiceShape["get"] = (id) =>
        Effect.gen(function*() {
          const job = yield* database
            .asUser(currentUser.userId, (tx) => QueueRepository.findById(tx, id))
            .pipe(Effect.mapError(toStorageError("inference.get")))

          if (job === null || job.kind !== "inference") {
            return yield* new NotFound({ entity: "InferenceJob", id })
          }
          return job
        })

      return InferenceService.of({ enqueue, get })
    })
  )
}
