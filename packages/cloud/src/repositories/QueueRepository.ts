import type { HarnessJob, JobKind, JobStage, JobStatus, QueueStats } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { harnessJob } from "../db/tables.ts"

export interface JobRow {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string | null
  readonly application_id: string | null
  readonly stage: string
  readonly kind: string
  readonly payload: unknown
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
        maxAttempts: input.stage === "submit" ? 1 : input.maxAttempts ?? 3,
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
}

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

/**
 * Claims one job and the account it belongs to.
 *
 * The account lease is taken first. If another performer holds the account, the
 * job is *not* left in `leased`: it is pushed five seconds into the future and
 * the claim returns empty, so a busy account never looks like a dead worker.
 */
export const claim = (tx: Executor, input: ClaimInput): RepoEffect<ClaimedJob | null> =>
  Effect.gen(function*() {
    const leaseSeconds = input.leaseSeconds ?? 120

    const [candidate] = (
      yield* tx.execute(sql`
        select id, hh_account_id, user_id
        from harness_jobs
        where status = 'pending'
          and run_at <= now()
          and ${kindClause(input.kinds)}
          and ${accountClause(input.accounts)}
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

    if (hhAccountId !== null) {
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

      if (leased.rows.length === 0) {
        yield* tx.execute(sql`
          update harness_jobs
          set run_at = now() + interval '5 seconds', updated_at = now()
          where id = ${jobId}
        `)
        return null
      }
    }

    const [row] = (
      yield* tx.execute(sql`
        update harness_jobs
        set status = 'leased',
            lease_id = uuidv7(),
            lease_epoch = lease_epoch + 1,
            lease_until = now() + make_interval(secs => ${leaseSeconds}),
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

/** Returns jobs whose performer stopped heartbeating. */
export const recoverExpired = (tx: Executor): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      update harness_jobs
      set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
          lease_id = null,
          lease_until = null,
          locked_by = null,
          run_at = now(),
          updated_at = now()
      where status in ('leased', 'running')
        and lease_until < now()
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.map((row) => row.id as string)))

export const stats = (tx: Executor): RepoEffect<QueueStats> =>
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
      where status = 'pending'
        or status in ('leased', 'running')
        or created_at > now() - interval '1 day'
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
  options: { readonly status?: string; readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<HarnessJob>> =>
  tx
    .select()
    .from(harnessJob)
    .where(
      options.status === undefined || options.status === ""
        ? sql`true`
        : sql`${harnessJob.status} = ${options.status}`
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
          lockedBy: row.lockedBy
        }
      })
    )
