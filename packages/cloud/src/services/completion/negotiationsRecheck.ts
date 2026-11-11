import type { HarnessExit } from "@otbor/contract"
import { Effect } from "effect"
import type { Executor } from "../../db/Database.ts"
import * as QueueRepository from "../../repositories/QueueRepository.ts"
import { negotiationsSyncJob } from "../jobs.ts"

const ACTIVE = ["pending", "leased", "running"]

/**
 * Заявка не ушла или не удалось понять, ушла ли она: возможно, отклик на эту
 * вакансию уже есть на hh (сделан руками или другим резюме). Ставим чтение
 * списка откликов аккаунта; импорт сам закроет заявки, которым hh не нужен.
 * Уже идущее чтение не дублируем. Капча и истёкшая сессия сверку не лечат:
 * чтение упёрлось бы в ту же стену.
 */
export const requestNegotiationsRecheck = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string | null
    readonly sessionProfile?: unknown
    readonly exit?: HarnessExit | undefined
  }
) =>
  Effect.gen(function*() {
    if (input.hhAccountId === null) return
    if (input.exit?.tag === "captcha" || input.exit?.tag === "session_expired") return
    const latest = yield* QueueRepository.latestForAccount(tx, input.hhAccountId, "negotiations_sync")
    if (latest !== null && ACTIVE.includes(latest.job.status)) return
    yield* negotiationsSyncJob(tx, {
      userId: input.userId,
      hhAccountId: input.hhAccountId,
      sessionProfile: typeof input.sessionProfile === "string" ? input.sessionProfile : null,
      sequence: (yield* QueueRepository.countForAccount(tx, input.hhAccountId, "negotiations_sync")) + 1
    })
  })
