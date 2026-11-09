import type {
  HarnessJob,
  JobKind,
  JobStage,
  JobStatus,
  QueueConcurrency,
  QueueStats,
  UserSettings
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { harnessJob } from "../db/tables.ts"
import * as SettingsRepository from "./SettingsRepository.ts"

export interface JobRow {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string | null
  readonly application_id: string | null
  readonly stage: string
  readonly kind: string
  readonly payload: unknown
  readonly result: unknown
  readonly status: string
  readonly priority: number
  readonly run_at: Date
  readonly attempts: number
  readonly max_attempts: number
  readonly lease_id: string | null
  readonly lease_epoch: number
  readonly lease_until: Date | null
  readonly created_at: Date
}

export const toJob = (row: JobRow): HarnessJob => ({
  id: row.id as HarnessJob["id"],
  kind: row.kind as JobKind,
  stage: row.stage as JobStage,
  status: row.status as JobStatus,
  priority: row.priority,
  payload: row.payload,
  result: row.result ?? null,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  leaseId: row.lease_id as HarnessJob["leaseId"],
  leaseEpoch: row.lease_epoch,
  leaseUntil: row.lease_until?.toISOString() ?? null,
  runAt: row.run_at.toISOString(),
  createdAt: row.created_at.toISOString()
})

/**
 * Drizzle selects come back with the schema's camelCase field names, raw SQL
 * with the column names. `toJob` speaks columns, so Drizzle rows are adapted
 * here instead of at five call sites.
 */
const fromSelect = (row: typeof harnessJob.$inferSelect): JobRow => ({
  id: row.id,
  user_id: row.userId,
  hh_account_id: row.hhAccountId,
  application_id: row.applicationId,
  stage: row.stage,
  kind: row.kind,
  payload: row.payload,
  result: row.result,
  status: row.status,
  priority: row.priority,
  run_at: row.runAt,
  attempts: row.attempts,
  max_attempts: row.maxAttempts,
  lease_id: row.leaseId,
  lease_epoch: row.leaseEpoch,
  lease_until: row.leaseUntil,
  created_at: row.createdAt
})

export interface EnqueueInput {
  readonly userId: string
  readonly hhAccountId: string | null
  readonly applicationId: string | null
  readonly stage: JobStage
  readonly kind: JobKind
  readonly payload: Record<string, unknown>
  readonly priority?: number
  readonly runAt?: Date
  readonly maxAttempts?: number
  readonly idempotencyKey: string
}

export const enqueue = (tx: Executor, input: EnqueueInput): RepoEffect<HarnessJob> =>
  Effect.gen(function*() {
    yield* tx
      .insert(harnessJob)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        applicationId: input.applicationId,
        stage: input.stage,
        kind: input.kind,
        payload: input.payload,
        priority: input.priority ?? 0,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.stage === "submit" || input.stage === "letter_attach" ? 1 : input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey
      })
      .onConflictDoNothing({ target: harnessJob.idempotencyKey })

    const [row] = yield* tx
      .select()
      .from(harnessJob)
      .where(sql`${harnessJob.idempotencyKey} = ${input.idempotencyKey}`)
      .limit(1)

    return toJob(fromSelect(row!))
  })

export interface ClaimInput {
  readonly holder: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<string>
  readonly leaseSeconds?: number
  /** Сколько браузерных задач одного аккаунта держит один харнесс разом. */
  readonly browserConcurrency?: number
  /** Из них задач, действующих от имени аккаунта (`ACTING_STAGES`). */
  readonly actingConcurrency?: number
  /**
   * Минимум секунд между двумя действующими задачами одного аккаунта; к нему
   * добавляется случайная надбавка (`submitJitterPercent`). 0 выключает темп.
   */
  readonly submitIntervalSeconds?: number
  /** Случайная надбавка к интервалу, процентов от него (по умолчанию 50). */
  readonly submitJitterPercent?: number
  /** Не больше стольких отправок аккаунта за скользящий час; `null` - без лимита. */
  readonly submitHourlyLimit?: number | null
  /** Чтений формы аккаунта разом, когда у владельца нет строки настроек. */
  readonly formReadConcurrency?: number
  /** Пауза между чтениями формы в секундах, когда у владельца нет строки настроек. */
  readonly formReadIntervalSeconds?: number
}

export const DEFAULT_ACCOUNT_BROWSER_CONCURRENCY = 4
export const DEFAULT_ACCOUNT_SUBMIT_CONCURRENCY = 1
/** Темп отправок аккаунта по умолчанию (`OTBOR_ACCOUNT_SUBMIT_INTERVAL_SECONDS`). */
export const DEFAULT_ACCOUNT_SUBMIT_INTERVAL_SECONDS = 75
/** Случайная надбавка к интервалу по умолчанию, процентов от него. */
export const DEFAULT_SUBMIT_JITTER_PERCENT = 50

/**
 * Стадии, которые действуют от имени аккаунта (клик «откликнуться», письмо в
 * чате). Остальные браузерные стадии только читают. Зеркало
 * неэксклюзивных `withPage` в харнессе: читающие идут параллельно.
 */
export const ACTING_STAGES: ReadonlyArray<JobStage> = ["submit", "letter_attach"]

/**
 * Стадии, которые открывают страницу отклика только чтобы прочитать форму.
 * hh показывает капчу и на них, поэтому у них свой потолок и своя пауза
 * (`formRead*` в настройках), независимые от отправок.
 */
export const FORM_READ_STAGES: ReadonlyArray<JobStage> = ["form_read", "prepare"]

export interface ClaimedJob {
  readonly job: HarnessJob
  readonly userId: string
  readonly hhAccountId: string | null
  readonly applicationId: string | null
}

const accountClause = (accounts: ReadonlyArray<string>) =>
  accounts.length === 0
    ? sql`hh_account_id is null`
    : sql`(hh_account_id is null or hh_account_id in (${sql.join(
        accounts.map((account) => sql`${account}`),
        sql`, `
      )}))`

const kindClause = (kinds: ReadonlyArray<JobKind>) =>
  kinds.length === 0
    ? sql`true`
    : sql`kind in (${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})`

const actingList = sql.join(ACTING_STAGES.map((stage) => sql`${stage}`), sql`, `)
const formReadList = sql.join(FORM_READ_STAGES.map((stage) => sql`${stage}`), sql`, `)

/**
 * Числовая настройка владельца задачи (`user_settings`) или `fallback`, пока
 * строки нет. Читается в самом запросе выбора кандидата, по `harness_jobs.user_id`.
 */
const settingOf = (column: string, fallback: number) =>
  sql`coalesce((select s.${sql.identifier(column)} from user_settings s where s.user_id = harness_jobs.user_id), ${fallback}::int)`

/** Сколько раз claim пробует другого кандидата, проиграв гонку за аккаунт. */
const CLAIM_ATTEMPTS = 5

/**
 * Занятость аккаунта для этого харнесса: сколько его браузерных задач уже
 * в `leased`/`running`, и сколько из них действующих. Один запрос на обе цифры.
 */
const accountLoad = (holder: string, accountId: string) => sql`
  select count(*)::int as total,
         count(*) filter (where r.stage in (${actingList}))::int as acting
  from harness_jobs r
  where r.hh_account_id = ${accountId}
    and r.kind = 'browser'
    and r.status in ('leased', 'running')
    and r.locked_by = ${holder}
`

/**
 * Claims the best job that can actually be started right now.
 *
 * Выбор кандидата сам отсекает то, что взять нельзя: браузерную задачу
 * аккаунта, которым владеет другой неистёкший держатель, или аккаунта, где
 * этот харнесс уже на потолке (всего или по действующим стадиям). Поэтому
 * занятый аккаунт не заслоняет inference и задачи других аккаунтов
 * (head-of-line blocking), и задачи не откладываются на 5 секунд.
 *
 * Потолки, темп и часовой лимит берутся из `user_settings` владельца задачи
 * при каждой выдаче (нет строки - значения из `ClaimInput`), так что правка из
 * интерфейса действует без перезапуска.
 *
 * Отсев в запросе — снимок. Гонку закрывает блокировка строки `account_lease`:
 * upsert берёт её, параллельный claim того же аккаунта ждёт до коммита и
 * пересчитывает занятость уже с нашей задачей. Проигравший по потолку
 * пробует следующего кандидата, исключив этот аккаунт.
 */
export const claim = (tx: Executor, input: ClaimInput): RepoEffect<ClaimedJob | null> =>
  Effect.gen(function*() {
    const leaseSeconds = input.leaseSeconds ?? 120
    // Значения на случай, когда у владельца задачи нет строки настроек.
    const defaults: UserSettings = {
      accountBrowserConcurrency: Math.max(1, input.browserConcurrency ?? DEFAULT_ACCOUNT_BROWSER_CONCURRENCY),
      accountActingConcurrency: Math.max(1, input.actingConcurrency ?? DEFAULT_ACCOUNT_SUBMIT_CONCURRENCY),
      submitIntervalSeconds: Math.max(0, input.submitIntervalSeconds ?? DEFAULT_ACCOUNT_SUBMIT_INTERVAL_SECONDS),
      submitJitterPercent: Math.max(0, input.submitJitterPercent ?? DEFAULT_SUBMIT_JITTER_PERCENT),
      submitHourlyLimit: input.submitHourlyLimit ?? null,
      harnessSlots: 6,
      formReadConcurrency: Math.max(1, input.formReadConcurrency ?? SettingsRepository.BUILTIN_SETTINGS.formReadConcurrency),
      formReadIntervalSeconds: Math.max(
        0,
        input.formReadIntervalSeconds ?? SettingsRepository.BUILTIN_SETTINGS.formReadIntervalSeconds
      ),
      formReadJitterPercent: SettingsRepository.BUILTIN_SETTINGS.formReadJitterPercent,
      formReadBlockedFactor: SettingsRepository.BUILTIN_SETTINGS.formReadBlockedFactor
    }
    const formReadCapSql = settingOf("form_read_concurrency", defaults.formReadConcurrency)
    const browserCapSql = settingOf("account_browser_concurrency", defaults.accountBrowserConcurrency)
    const actingCapSql = sql`least(${browserCapSql}, ${
      settingOf("account_acting_concurrency", defaults.accountActingConcurrency)
    })`
    const hourlyLimitSql = sql`(case when exists (select 1 from user_settings s where s.user_id = harness_jobs.user_id)
      then (select s.submit_hourly_limit from user_settings s where s.user_id = harness_jobs.user_id)
      else ${defaults.submitHourlyLimit}::int end)`
    const rejectedAccounts: Array<string> = []

    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      const rejected = rejectedAccounts.length === 0
        ? sql`true`
        : sql`(hh_account_id is null or hh_account_id not in (${sql.join(
            rejectedAccounts.map((account) => sql`${account}`),
            sql`, `
          )}))`

      const [candidate] = (
        yield* tx.execute(sql`
          select id, hh_account_id, user_id, kind, stage
          from harness_jobs
          where status = 'pending'
            and run_at <= now()
            and ${kindClause(input.kinds)}
            and ${accountClause(input.accounts)}
            and ${rejected}
            and (
              application_id is null
              or exists (
                select 1 from application a
                where a.id = harness_jobs.application_id
                  and (
                    (harness_jobs.stage = 'prepare' and a.state in ('draft', 'queued', 'needs_human', 'failed'))
                    or (harness_jobs.stage = 'submit' and a.state = 'queued')
                    or (harness_jobs.stage = 'reconcile' and a.state in ('submitting', 'needs_human', 'failed'))
                    or harness_jobs.stage = 'session'
                    or harness_jobs.stage = 'inference'
                  )
              )
            )
            and (
              kind <> 'browser'
              or hh_account_id is null
              or (
                not exists (
                  select 1 from account_lease l
                  where l.hh_account_id = harness_jobs.hh_account_id
                    and l.expires_at >= now()
                    and l.holder <> ${input.holder}
                )
                and (
                  select count(*) from harness_jobs r
                  where r.hh_account_id = harness_jobs.hh_account_id
                    and r.kind = 'browser'
                    and r.status in ('leased', 'running')
                    and r.locked_by = ${input.holder}
                ) < ${browserCapSql}
                and (
                  harness_jobs.stage not in (${actingList})
                  or exists (
                    -- Темп и блокировка после капчи: действующую задачу аккаунт
                    -- принимает не раньше submit_next_at и пока оператор не снял блокировку.
                    select 1 from hh_account pa
                    where pa.id = harness_jobs.hh_account_id
                      and (pa.submit_next_at is null or pa.submit_next_at <= now())
                      and pa.submit_blocked_at is null
                  )
                )
                and (
                  -- Чтение формы: свой потолок параллельности и пауза между стартами.
                  harness_jobs.stage not in (${formReadList})
                  or (
                    (
                      select count(*) from harness_jobs r
                      where r.hh_account_id = harness_jobs.hh_account_id
                        and r.kind = 'browser'
                        and r.status in ('leased', 'running')
                        and r.locked_by = ${input.holder}
                        and r.stage in (${formReadList})
                    ) < ${formReadCapSql}
                    and exists (
                      select 1 from hh_account fa
                      where fa.id = harness_jobs.hh_account_id
                        and (fa.form_read_next_at is null or fa.form_read_next_at <= now())
                    )
                  )
                )
                and (
                  -- Часовой лимит отправок аккаунта (null - без лимита).
                  harness_jobs.stage <> 'submit'
                  or ${hourlyLimitSql} is null
                  or (
                    select count(*) from harness_jobs r
                    where r.hh_account_id = harness_jobs.hh_account_id
                      and r.stage = 'submit'
                      and r.leased_at > now() - interval '1 hour'
                  ) < ${hourlyLimitSql}
                )
                and (
                  harness_jobs.stage not in (${actingList})
                  or (
                    select count(*) from harness_jobs r
                    where r.hh_account_id = harness_jobs.hh_account_id
                      and r.kind = 'browser'
                      and r.status in ('leased', 'running')
                      and r.locked_by = ${input.holder}
                      and r.stage in (${actingList})
                  ) < ${actingCapSql}
                )
              )
            )
          order by priority desc, run_at asc
          for update skip locked
          limit 1
        `)
      ).rows

      if (candidate === undefined) return null

      const jobId = candidate.id as string
      const hhAccountId = candidate.hh_account_id as string | null
      const candidateKind = candidate.kind as string

      // Аренда и потолки только у браузерных задач: inference не привязан к
      // профилю Chrome и не должен зависеть от занятости аккаунта.
      if (hhAccountId !== null && candidateKind === "browser") {
        const leased = yield* tx.execute(sql`
          insert into account_lease (hh_account_id, holder, epoch, expires_at)
          values (${hhAccountId}, ${input.holder}, 1, now() + make_interval(secs => ${leaseSeconds * 5}))
          on conflict (hh_account_id) do update
          set holder = excluded.holder,
              epoch = account_lease.epoch + 1,
              expires_at = excluded.expires_at
          where account_lease.expires_at < now()
             or account_lease.holder = excluded.holder
          returning epoch
        `)

        // Аккаунт перехватил другой держатель между выбором и арендой.
        if (leased.rows.length === 0) {
          rejectedAccounts.push(hhAccountId)
          continue
        }

        // Строка account_lease заблокирована нами до коммита, так что
        // пересчёт видит всё, что закоммитили параллельные claim этого аккаунта.
        const [load] = (yield* tx.execute(accountLoad(input.holder, hhAccountId))).rows
        const total = Number(load?.total ?? 0)
        const acting = Number(load?.acting ?? 0)
        const isActing = ACTING_STAGES.includes(candidate.stage as JobStage)
        const settings = yield* SettingsRepository.effective(tx, candidate.user_id as string, defaults)
        const browserCap = settings.accountBrowserConcurrency
        const actingCap = Math.min(browserCap, settings.accountActingConcurrency)
        if (total >= browserCap || (isActing && acting >= actingCap)) {
          rejectedAccounts.push(hhAccountId)
          continue
        }

        // Чтение формы: потолок и пауза проверяются и назначаются под той же
        // блокировкой account_lease. Пока аккаунт заблокирован капчей, пауза
        // растягивается в `formReadBlockedFactor` раз.
        if (FORM_READ_STAGES.includes(candidate.stage as JobStage)) {
          const reading = yield* tx.execute(sql`
            select count(*)::int as n from harness_jobs r
            where r.hh_account_id = ${hhAccountId} and r.kind = 'browser'
              and r.status in ('leased', 'running') and r.locked_by = ${input.holder}
              and r.stage in (${formReadList})
          `)
          if (Number((reading.rows[0] as { n?: number } | undefined)?.n ?? 0) >= settings.formReadConcurrency) {
            rejectedAccounts.push(hhAccountId)
            continue
          }
          const base = settings.formReadIntervalSeconds
          const jitter = base * (settings.formReadJitterPercent / 100) * Math.random()
          const paced = yield* tx.execute(sql`
            update hh_account
            set form_read_next_at = now() + make_interval(
              secs => (${base} + ${jitter}) * case when submit_blocked_at is not null then ${settings.formReadBlockedFactor} else 1 end
            )
            where id = ${hhAccountId}
              and (form_read_next_at is null or form_read_next_at <= now())
            returning id
          `)
          if (paced.rows.length === 0) {
            rejectedAccounts.push(hhAccountId)
            continue
          }
        }

        // Часовой лимит перепроверяем под той же блокировкой: выбор кандидата - снимок.
        if (candidate.stage === "submit" && settings.submitHourlyLimit !== null) {
          const used = yield* tx.execute(sql`
            select count(*)::int as n from harness_jobs
            where hh_account_id = ${hhAccountId} and stage = 'submit'
              and leased_at > now() - interval '1 hour'
          `)
          if (Number((used.rows[0] as { n?: number } | undefined)?.n ?? 0) >= settings.submitHourlyLimit) {
            rejectedAccounts.push(hhAccountId)
            continue
          }
        }

        if (isActing) {
          // Темп проверяем и назначаем под той же блокировкой account_lease:
          // параллельный claim этого аккаунта видит уже сдвинутый submit_next_at.
          const intervalSeconds = settings.submitIntervalSeconds
          const jitter = intervalSeconds * (settings.submitJitterPercent / 100) * Math.random()
          const paced = yield* tx.execute(sql`
            update hh_account
            set submit_next_at = now() + make_interval(secs => ${intervalSeconds + jitter})
            where id = ${hhAccountId}
              and (submit_next_at is null or submit_next_at <= now())
              and submit_blocked_at is null
            returning id
          `)
          if (paced.rows.length === 0) {
            rejectedAccounts.push(hhAccountId)
            continue
          }
        }
      }

      const [row] = (
        yield* tx.execute(sql`
          update harness_jobs
          set status = 'leased',
              lease_id = uuidv7(),
              lease_epoch = lease_epoch + 1,
              lease_until = now() + make_interval(secs => ${leaseSeconds}),
              leased_at = now(),
              locked_by = ${input.holder},
              attempts = attempts + 1,
              updated_at = now()
          where id = ${jobId}
          returning *
        `)
      ).rows

      return {
        job: toJob(row as unknown as JobRow),
        userId: row!.user_id as string,
        hhAccountId,
        applicationId: row!.application_id as string | null
      }
    }

    return null
  })

/** Extends the lease. Zero rows means the lease was lost: stop working. */
export const heartbeat = (
  tx: Executor,
  input: {
    readonly jobId: string
    readonly leaseId: string
    readonly epoch: number
    readonly holder: string
    readonly leaseSeconds?: number
  }
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = case when status = 'leased' then 'running' else status end,
          lease_until = now() + make_interval(secs => ${input.leaseSeconds ?? 120}),
          updated_at = now()
      where id = ${input.jobId}
        and lease_id = ${input.leaseId}
        and lease_epoch = ${input.epoch}
        and locked_by = ${input.holder}
        and status in ('leased', 'running')
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface CompleteJobInput {
  readonly jobId: string
  readonly leaseId: string
  readonly epoch: number
  readonly holder: string
  readonly status: JobStatus
  readonly lastError: string | null
  readonly result?: unknown
  readonly runAt?: Date | null
}

/**
 * Fenced completion: a worker whose epoch was superseded gets `false` and must
 * not write anything else. Repeated completion with the same epoch is a no-op.
 */
export const complete = (
  tx: Executor,
  input: CompleteJobInput
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = ${input.status},
          lease_until = null,
          last_error = ${input.lastError},
          result = ${
            input.result === undefined
              ? sql`result`
              : sql`${JSON.stringify(input.result)}::jsonb`
          },
          run_at = ${input.runAt ?? sql`run_at`},
          updated_at = now()
      where id = ${input.jobId}
        and lease_id = ${input.leaseId}
        and lease_epoch = ${input.epoch}
        and locked_by = ${input.holder}
        and status in ('leased', 'running')
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export interface RecoveredJob {
  readonly id: string
  readonly stage: string
  readonly status: string
  readonly userId: string
  readonly applicationId: string | null
}

/**
 * Handles jobs whose performer stopped heartbeating. A submit job is never put
 * back in the queue: the click may already have happened, so it becomes
 * `needs_reconcile` and the caller queues a reconcile. Other stages return to
 * `pending`, or `dead` once their attempts are spent.
 */
export const recoverExpired = (tx: Executor): RepoEffect<ReadonlyArray<RecoveredJob>> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = case
            when stage = 'submit' then 'needs_reconcile'
            when attempts >= max_attempts then 'dead'
            else 'pending'
          end,
          lease_id = null,
          lease_until = null,
          locked_by = null,
          run_at = now(),
          last_error = case
            when stage = 'submit' then 'lease expired during submit; outcome unknown'
            else last_error
          end,
          updated_at = now()
      where status in ('leased', 'running')
        and lease_until < now()
      returning id, stage, status, user_id, application_id
    `)
    .pipe(
      Effect.map((result) =>
        result.rows.map((row) => ({
          id: row.id as string,
          stage: row.stage as string,
          status: row.status as string,
          userId: row.user_id as string,
          applicationId: row.application_id as string | null
        }))
      )
    )

export const stats = (tx: Executor, kind?: string): RepoEffect<QueueStats> =>
  tx
    .execute(sql`
      select
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'leased')::int as leased,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'done')::int as done,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'dead')::int as dead,
        count(*) filter (where status = 'needs_human')::int as needs_human,
        count(*) filter (where status = 'needs_reconcile')::int as needs_reconcile,
        coalesce(max(extract(epoch from (now() - created_at))), 0)::int as oldest
      from harness_jobs
      where (status = 'pending'
        or status in ('leased', 'running')
        or created_at > now() - interval '1 day')
        ${kind === undefined ? sql`` : sql`and kind = ${kind}`}
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as Record<string, number> | undefined
        return {
          pending: Number(row?.pending ?? 0),
          leased: Number(row?.leased ?? 0),
          running: Number(row?.running ?? 0),
          done: Number(row?.done ?? 0),
          failed: Number(row?.failed ?? 0),
          dead: Number(row?.dead ?? 0),
          needsHuman: Number(row?.needs_human ?? 0),
          needsReconcile: Number(row?.needs_reconcile ?? 0),
          oldestPendingAgeSeconds: Number(row?.oldest ?? 0)
        }
      })
    )

interface ConcurrencyCaps {
  readonly browserCap: number
  readonly actingCap: number
  readonly submitIntervalSeconds: number
  readonly submitJitterPercent: number
  readonly submitHourlyLimit: number | null
  readonly harnessSlots: number
  readonly formReadConcurrency: number
  readonly formReadIntervalSeconds: number
  readonly formReadJitterPercent: number
  readonly formReadBlockedFactor: number
}

const stageCounts = (rows: ReadonlyArray<Record<string, unknown>>) =>
  rows.map((row) => ({ stage: String(row.stage) as JobStage, count: Number(row.n) }))

/**
 * Параллельность одним снимком: потоки харнессов, занятость аккаунтов по
 * стадиям, кто держит аккаунт. Идёт от владельца, потому что `account_lease`
 * закрыт RLS; всё остальное фильтруется по `user_id` вручную.
 */
export const concurrency = (
  tx: Executor,
  userId: string,
  caps: ConcurrencyCaps
): RepoEffect<QueueConcurrency> =>
  Effect.gen(function*() {
    const harnesses = (yield* tx.execute(sql`
      select h.id, h.name, h.concurrency, h.last_seen_at,
             (select count(*)::int from harness_jobs j
               where j.user_id = ${userId} and j.locked_by = h.id::text
                 and j.status in ('leased', 'running')) as busy
      from harness h
      where h.user_id = ${userId}
        -- Только живые: не отозванные и выходившие на связь за 10 минут (или с
        -- задачами в работе). Старые и тестовые регистрации не показываются.
        and h.token_hash is not null
        and (h.last_seen_at > now() - interval '10 minutes'
          or exists (select 1 from harness_jobs j
                      where j.locked_by = h.id::text and j.status in ('leased', 'running')))
      order by h.name
    `)).rows as ReadonlyArray<Record<string, unknown>>

    const accounts = (yield* tx.execute(sql`
      select a.id,
             coalesce(
               nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''),
               nullif(a.label, ''),
               a.id::text
             ) as name,
             l.holder, h.name as holder_name,
             case when a.submit_next_at > now() then a.submit_next_at end as next_submit_at,
             a.submit_blocked_at as blocked_at,
             a.submit_block_reason as block_reason
      from hh_account a
      left join account_lease l on l.hh_account_id = a.id and l.expires_at > now()
      left join harness h on h.id::text = l.holder and h.user_id = a.user_id
      where a.user_id = ${userId}
      order by a.is_default desc, name
    `)).rows as ReadonlyArray<Record<string, unknown>>

    const running = (yield* tx.execute(sql`
      select hh_account_id, stage, count(*)::int as n
      from harness_jobs
      where user_id = ${userId} and kind = 'browser' and status in ('leased', 'running')
      group by hh_account_id, stage
    `)).rows as ReadonlyArray<Record<string, unknown>>

    const pending = (yield* tx.execute(sql`
      select hh_account_id, stage, count(*)::int as n,
             coalesce(max(extract(epoch from (now() - run_at))), 0)::int as age
      from harness_jobs
      where user_id = ${userId} and kind = 'browser' and status = 'pending' and run_at <= now()
      group by hh_account_id, stage
    `)).rows as ReadonlyArray<Record<string, unknown>>

    const inference = (yield* tx.execute(sql`
      select count(*) filter (where status in ('leased', 'running'))::int as running,
             count(*) filter (where status = 'pending' and run_at <= now())::int as pending
      from harness_jobs
      where user_id = ${userId} and kind = 'inference'
    `)).rows[0] as Record<string, unknown> | undefined

    const forAccount = (rows: ReadonlyArray<Record<string, unknown>>, id: string | null) =>
      rows.filter((row) => (row.hh_account_id === null ? null : String(row.hh_account_id)) === id)
    const sum = (rows: ReadonlyArray<{ readonly count: number }>) => rows.reduce((total, r) => total + r.count, 0)

    return {
      browserCap: caps.browserCap,
      actingCap: caps.actingCap,
      submitIntervalSeconds: caps.submitIntervalSeconds,
      submitJitterPercent: caps.submitJitterPercent,
      submitHourlyLimit: caps.submitHourlyLimit,
      harnessSlots: caps.harnessSlots,
      formReadConcurrency: caps.formReadConcurrency,
      formReadIntervalSeconds: caps.formReadIntervalSeconds,
      formReadJitterPercent: caps.formReadJitterPercent,
      formReadBlockedFactor: caps.formReadBlockedFactor,
      actingStages: ACTING_STAGES,
      harnesses: harnesses.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        slots: row.concurrency === null ? null : Number(row.concurrency),
        busy: Number(row.busy),
        lastSeenAt: row.last_seen_at === null ? null : new Date(String(row.last_seen_at)).toISOString()
      })),
      accounts: accounts.map((row) => {
        const id = String(row.id)
        const run = stageCounts(forAccount(running, id))
        const wait = forAccount(pending, id)
        return {
          id,
          name: String(row.name),
          holderHarnessId: row.holder === null ? null : String(row.holder),
          holderHarnessName: row.holder_name === null ? null : String(row.holder_name),
          nextSubmitAt: row.next_submit_at == null ? null : new Date(String(row.next_submit_at)).toISOString(),
          submitBlockedAt: row.blocked_at == null ? null : new Date(String(row.blocked_at)).toISOString(),
          submitBlockReason: row.block_reason == null ? null : String(row.block_reason),
          running: run,
          browserRunning: sum(run),
          actingRunning: sum(run.filter((c) => ACTING_STAGES.includes(c.stage))),
          pending: stageCounts(wait),
          pendingTotal: sum(stageCounts(wait)),
          oldestPendingAgeSeconds: Math.max(0, ...wait.map((r) => Number(r.age)))
        }
      }),
      unassigned: {
        running: stageCounts(forAccount(running, null)),
        pending: stageCounts(forAccount(pending, null))
      },
      inference: { running: Number(inference?.running ?? 0), pending: Number(inference?.pending ?? 0) }
    } as unknown as QueueConcurrency
  })

export const oldestPendingAge = (tx: Executor): RepoEffect<number> =>
  tx
    .execute(sql`
      select coalesce(extract(epoch from (now() - min(run_at))), 0)::int as age
      from harness_jobs where status = 'pending' and run_at <= now()
    `)
    .pipe(
      Effect.map((result) => Number((result.rows[0] as { age?: number } | undefined)?.age ?? 0))
    )

export const list = (
  tx: Executor,
  options: { readonly status?: string; readonly kind?: string; readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<HarnessJob>> =>
  tx
    .select()
    .from(harnessJob)
    .where(
      sql`${options.status === undefined || options.status === ""
        ? sql`true`
        : sql`${harnessJob.status} = ${options.status}`}
        and ${options.kind === undefined ? sql`true` : sql`${harnessJob.kind} = ${options.kind}`}`
    )
    .orderBy(sql`${harnessJob.createdAt} desc`)
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200))
    .pipe(Effect.map((rows) => rows.map((row) => toJob(fromSelect(row)))))

export const cancelForApplication = (
  tx: Executor,
  applicationId: string,
  exceptStages: ReadonlyArray<JobStage> = []
): RepoEffect<number> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = 'cancelled', updated_at = now()
      where application_id = ${applicationId}
        and status = 'pending'
        ${exceptStages.length === 0
          ? sql``
          : sql`and stage not in (${sql.join(exceptStages.map((stage) => sql`${stage}`), sql`, `)})`}
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length))

/**
 * Closes the submit job a reconcile has explained. Only a job parked in
 * `needs_reconcile` is touched, and only to a state that matches what the
 * reconcile proved: `done` (the response exists) or `failed` with
 * `clicked: false` (it never reached hh, which is what lets a human approve a
 * new submit after re-checking).
 */
export const settleSubmit = (
  tx: Executor,
  applicationId: string,
  input: { readonly status: "done" | "failed"; readonly result: unknown; readonly message: string }
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = ${input.status},
          result = ${JSON.stringify(input.result)}::jsonb,
          last_error = ${input.message},
          updated_at = now()
      where id = (
        select id from harness_jobs
        where application_id = ${applicationId}
          and stage = 'submit'
          and status = 'needs_reconcile'
        order by created_at desc
        limit 1
      )
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

export const findById = (tx: Executor, id: string): RepoEffect<HarnessJob | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(sql`${harnessJob.id} = ${id}`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined ? null : toJob(fromSelect(rows[0]))
      )
    )

/** The job stored under an idempotency key, if any. */
export const findByKey = (tx: Executor, idempotencyKey: string): RepoEffect<HarnessJob | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(sql`${harnessJob.idempotencyKey} = ${idempotencyKey}`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined ? null : toJob(fromSelect(rows[0]))
      )
    )

/** How many jobs of a stage an application has ever had, retries included. */
export const countFor = (
  tx: Executor,
  applicationId: string,
  stage: JobStage
): RepoEffect<number> =>
  tx
    .execute(sql`
      select count(*)::int as count
      from harness_jobs
      where application_id = ${applicationId} and stage = ${stage}
    `)
    .pipe(
      Effect.map((result) => Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0))
    )

/** The newest job of the given stages, cancelled ones excluded. */
export const latestFor = (
  tx: Executor,
  applicationId: string,
  stages: ReadonlyArray<JobStage>
): RepoEffect<HarnessJob | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(
      sql`${harnessJob.applicationId} = ${applicationId}
        and ${harnessJob.status} <> 'cancelled'
        and ${harnessJob.stage} in (${sql.join(
          stages.map((stage) => sql`${stage}`),
          sql`, `
        )})`
    )
    .orderBy(sql`${harnessJob.createdAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined ? null : toJob(fromSelect(rows[0]))
      )
    )

/**
 * Everything the completer needs: the public job plus the columns RLS hides
 * from the DTO (owner, application, account).
 */
export interface JobContext {
  readonly job: HarnessJob
  readonly userId: string
  readonly hhAccountId: string | null
  readonly applicationId: string | null
  readonly lockedBy: string | null
  /** Ключ идемпотентности: по нему узнают, чья это задача (например письмо автозаявки). */
  readonly idempotencyKey: string
}

export const context = (tx: Executor, id: string): RepoEffect<JobContext | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(sql`${harnessJob.id} = ${id}`)
    .limit(1)
    .pipe(
      Effect.map((rows) => {
        const row = rows[0]
        if (row === undefined) return null
        return {
          job: toJob(fromSelect(row)),
          userId: row.userId,
          hhAccountId: row.hhAccountId,
          applicationId: row.applicationId,
          lockedBy: row.lockedBy,
          idempotencyKey: row.idempotencyKey
        }
      })
    )

/** Newest non-cancelled job of a stage for an account (jobs without an application). */
export const latestForAccount = (
  tx: Executor,
  hhAccountId: string,
  stage: JobStage
): RepoEffect<{
  readonly job: HarnessJob
  readonly lastError: string | null
  readonly updatedAt: Date
} | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(
      sql`${harnessJob.hhAccountId} = ${hhAccountId}
        and ${harnessJob.stage} = ${stage}
        and ${harnessJob.status} <> 'cancelled'`
    )
    .orderBy(sql`${harnessJob.createdAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined
          ? null
          : {
              job: toJob(fromSelect(rows[0])),
              lastError: rows[0].lastError ?? null,
              updatedAt: rows[0].updatedAt
            }
      )
    )

/** How many jobs of a stage an account has ever had, so an explicit rerun gets a new key. */
export const countForAccount = (
  tx: Executor,
  hhAccountId: string,
  stage: JobStage
): RepoEffect<number> =>
  tx
    .execute(
      sql`select count(*)::int as n from harness_jobs where hh_account_id = ${hhAccountId} and stage = ${stage}`
    )
    .pipe(Effect.map((result) => Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0)))

/** Newest non-cancelled job of a stage for a vacancy and account (jobs without an application). */
export const latestForVacancy = (
  tx: Executor,
  hhAccountId: string,
  vacancyId: string,
  stage: JobStage,
  chatId: string | null = null
): RepoEffect<{
  readonly job: HarnessJob
  readonly lastError: string | null
  readonly updatedAt: Date
} | null> =>
  tx
    .select()
    .from(harnessJob)
    .where(
      sql`${harnessJob.hhAccountId} = ${hhAccountId}
        and ${harnessJob.stage} = ${stage}
        and ${harnessJob.payload}->>'vacancyId' = ${vacancyId}
        and (${chatId}::text is null or ${harnessJob.payload}->>'chatId' = ${chatId})
        and ${harnessJob.status} <> 'cancelled'`
    )
    .orderBy(sql`${harnessJob.createdAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined
          ? null
          : {
              job: toJob(fromSelect(rows[0])),
              lastError: rows[0].lastError ?? null,
              updatedAt: rows[0].updatedAt
            }
      )
    )

/** How many jobs of a stage a vacancy and account have ever had. */
export const countForVacancy = (
  tx: Executor,
  hhAccountId: string,
  vacancyId: string,
  stage: JobStage,
  chatId: string | null = null
): RepoEffect<number> =>
  tx
    .execute(
      sql`select count(*)::int as n from harness_jobs
          where hh_account_id = ${hhAccountId} and stage = ${stage} and payload->>'vacancyId' = ${vacancyId}
            and (${chatId}::text is null or payload->>'chatId' = ${chatId})`
    )
    .pipe(Effect.map((result) => Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0)))


/** Последняя ошибка задачи (`last_error`): почему харнесс не справился. */
export const lastErrorOf = (tx: Executor, jobId: string): RepoEffect<string | null> =>
  tx
    .execute(sql`select last_error from harness_jobs where id = ${jobId}`)
    .pipe(
      Effect.map((result) => (result.rows[0] as { last_error?: string | null } | undefined)?.last_error ?? null)
    )
