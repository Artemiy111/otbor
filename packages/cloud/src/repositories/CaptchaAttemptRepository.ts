/**
 * Журнал распознавания капчи моделью. Пишется из `QueueService.complete` по
 * отчёту харнеса; читается страницей настроек.
 */
import type { CaptchaAttemptReport, CaptchaModelStat, CaptchaSolveRecord } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"

/** Сохраняет попытки одной задачи. Пустой отчёт ничего не пишет. */
export const record = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string | null
    readonly jobId: string
    readonly stage: string
    readonly attempts: ReadonlyArray<CaptchaAttemptReport>
  }
): RepoEffect<void> =>
  Effect.forEach(
    input.attempts.slice(0, 20),
    (item) =>
      tx.execute(sql`
        insert into captcha_attempt (
          user_id, hh_account_id, job_id, stage, harness, model, attempt, answer, outcome, duration_ms, error
        ) values (
          ${input.userId}, ${input.hhAccountId}::uuid, ${input.jobId}::uuid, ${input.stage},
          ${item.harness.slice(0, 80)}, ${item.model.slice(0, 200)}, ${item.attempt},
          ${item.answer === null ? null : item.answer.slice(0, 200)}, ${item.outcome}, ${item.durationMs},
          ${item.error === null ? null : item.error.slice(0, 500)}
        )
      `),
    { discard: true }
  )

const iso = (value: unknown): string => new Date(value as string).toISOString()

/** Последние капчи (по задаче) и сводка по моделям. */
export const recent = (
  tx: Executor,
  userId: string,
  input: { readonly hhAccountId?: string | undefined; readonly limit: number }
): RepoEffect<{ readonly solves: ReadonlyArray<CaptchaSolveRecord>; readonly models: ReadonlyArray<CaptchaModelStat> }> =>
  Effect.gen(function*() {
    const account = input.hhAccountId ?? null
    // Одна капча = одна задача + модель: её попытки идут подряд.
    const grouped = sql`
      select job_id, harness, model,
             min(created_at) as at,
             (array_agg(stage))[1] as stage,
             (array_agg(hh_account_id))[1] as hh_account_id,
             count(*)::int as attempts,
             bool_or(outcome = 'solved') as solved,
             (array_agg(answer order by attempt desc))[1] as answer,
             sum(duration_ms)::int as duration_ms
      from captcha_attempt
      where user_id = ${userId}
        and (${account}::uuid is null or hh_account_id = ${account}::uuid)
      group by job_id, harness, model
    `
    const solves = yield* tx.execute(sql`select * from (${grouped}) g order by at desc limit ${input.limit}`)
    const models = yield* tx.execute(sql`
      select harness, model, count(*)::int as captchas,
             count(*) filter (where solved)::int as solved, sum(attempts)::int as attempts
      from (${grouped}) g
      group by harness, model
      order by captchas desc
    `)
    return {
      solves: (solves.rows as ReadonlyArray<Record<string, unknown>>).map((row): CaptchaSolveRecord => ({
        jobId: String(row.job_id) as CaptchaSolveRecord["jobId"],
        at: iso(row.at),
        stage: String(row.stage),
        hhAccountId: row.hh_account_id === null ? null : (String(row.hh_account_id) as CaptchaSolveRecord["hhAccountId"]),
        harness: String(row.harness),
        model: String(row.model),
        attempts: Number(row.attempts),
        solved: Boolean(row.solved),
        answer: row.answer === null ? null : String(row.answer),
        durationMs: Number(row.duration_ms)
      })),
      models: (models.rows as ReadonlyArray<Record<string, unknown>>).map((row): CaptchaModelStat => ({
        harness: String(row.harness),
        model: String(row.model),
        captchas: Number(row.captchas),
        solved: Number(row.solved),
        attempts: Number(row.attempts)
      }))
    }
  })
