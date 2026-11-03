import type {
  ApplicationDetail,
  ApplicationRecord,
  AttemptRecord,
  HarnessExit,
  KitAnswer,
  KitRecord,
  ResponseForm,
  StoredForm,
  StoredHint
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { application, applicationAttempt, applicationForm, applicationKit } from "../db/tables.ts"

export const APPLICABLE_STATES = ["draft", "needs_human", "failed"] as const

export interface ApplicationRow {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string
  readonly vacancy_id: string
  readonly vacancy_title: string | null
  readonly employer_name: string | null
  readonly resume_id: string | null
  readonly stream_id: string | null
  readonly decision_id: string | null
  readonly state: string
  readonly origin?: string
  readonly hh_status?: string | null
  readonly hh_responded_at?: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const selection = sql`
  select a.*, v.title as vacancy_title, e.name as employer_name
  from application a
  join vacancy v on v.id = a.vacancy_id
  left join employer e on e.id = v.employer_id
`

export const toRecord = (row: ApplicationRow): ApplicationRecord => ({
  id: row.id as ApplicationRecord["id"],
  userId: row.user_id as ApplicationRecord["userId"],
  hhAccountId: row.hh_account_id as ApplicationRecord["hhAccountId"],
  vacancyId: row.vacancy_id as ApplicationRecord["vacancyId"],
  vacancyTitle: row.vacancy_title ?? undefined,
  employerName: row.employer_name,
  resumeId: row.resume_id as ApplicationRecord["resumeId"],
  streamId: row.stream_id,
  decisionId: row.decision_id as ApplicationRecord["decisionId"],
  state: row.state as ApplicationRecord["state"],
  origin: (row.origin ?? "otbor") as ApplicationRecord["origin"],
  hhStatus: row.hh_status ?? null,
  hhRespondedAt: row.hh_responded_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
})

export const create = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly resumeId: string | null
    readonly streamId: string | null
    readonly decisionId: string | null
    readonly state: "draft" | "queued"
  }
): RepoEffect<{ readonly record: ApplicationRecord; readonly created: boolean }> =>
  Effect.gen(function*() {
    const inserted = yield* tx
      .insert(application)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        vacancyId: input.vacancyId,
        resumeId: input.resumeId,
        streamId: input.streamId,
        decisionId: input.decisionId,
        state: input.state
      })
      .onConflictDoNothing({ target: [application.hhAccountId, application.vacancyId] })
      .returning({ id: application.id })

    const id =
      inserted[0]?.id ??
      (yield* tx
        .select({ id: application.id })
        .from(application)
        .where(
          sql`${application.hhAccountId} = ${input.hhAccountId} and ${application.vacancyId} = ${input.vacancyId}`
        )
        .limit(1)
      )[0]?.id

    if (id === undefined) {
      throw new Error("application insert neither inserted nor found a row")
    }

    const record = yield* find(tx, input.userId, id)
    return { record: record!.application, created: inserted.length > 0 }
  })

export const find = (
  tx: Executor,
  userId: string,
  id: string
): RepoEffect<ApplicationDetail | null> =>
  Effect.gen(function*() {
    const [row] = (
      yield* tx.execute(
        sql`${selection} where a.id = ${id} and a.user_id = ${userId} limit 1`
      )
    ).rows
    if (row === undefined) return null

    const record = toRecord(row as unknown as ApplicationRow)
    const kit = yield* findKit(tx, id)
    const form = yield* findForm(tx, id)
    const attempts = yield* listAttempts(tx, id)

    return { application: record, kit, form, attempts }
  })

export const list = (
  tx: Executor,
  userId: string,
  options: { readonly state?: string; readonly hhAccountId?: string; readonly limit?: number } = {}
): RepoEffect<ReadonlyArray<ApplicationRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where a.user_id = ${userId}
        ${options.state === undefined || options.state === ""
          ? sql``
          : sql`and a.state = ${options.state}`}
        ${options.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${options.hhAccountId}`}
      order by a.updated_at desc
      limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<ApplicationRow>).map(toRecord)
      )
    )

/** Transition with an explicit guard, so a stale actor cannot resurrect a submit. */
export const transition = (
  tx: Executor,
  userId: string,
  id: string,
  to: ApplicationRecord["state"],
  guard: { readonly from: ReadonlyArray<ApplicationRecord["state"]>; readonly patch?: Record<string, unknown> }
): RepoEffect<ApplicationRecord | null> =>
  Effect.gen(function*() {
    const from = sql.join(guard.from.map((state) => sql`${state}`), sql`, `)
    const patch = guard.patch ?? {}
    const patchSql =
      Object.keys(patch).length === 0
        ? sql``
        : sql`, ${sql.join(
            Object.entries(patch).map(([key, value]) => sql`${sql.identifier(snake(key))} = ${value}`),
            sql`, `
          )}`

    const updated = yield* tx.execute(sql`
      update application
      set state = ${to}, updated_at = now()${patchSql}
      where id = ${id} and user_id = ${userId} and state in (${from})
      returning id
    `)

    if (updated.rows.length === 0) return null
    const detail = yield* find(tx, userId, id)
    return detail?.application ?? null
  })

export const findAny = (tx: Executor, id: string): RepoEffect<ApplicationRecord | null> =>
  tx
    .execute(sql`${selection} where a.id = ${id} limit 1`)
    .pipe(
      Effect.map((result) =>
        result.rows[0] === undefined ? null : toRecord(result.rows[0] as unknown as ApplicationRow)
      )
    )

export const existsForVacancy = (
  tx: Executor,
  hhAccountId: string,
  vacancyId: string
): RepoEffect<boolean> =>
  tx
    .select({ id: application.id })
    .from(application)
    .where(sql`${application.hhAccountId} = ${hhAccountId} and ${application.vacancyId} = ${vacancyId}`)
    .limit(1)
    .pipe(Effect.map((rows) => rows.length > 0))

/* -------------------------------------------------------------------------- */
/* Kits                                                                       */
/* -------------------------------------------------------------------------- */

export const upsertKit = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly applicationId: string
    readonly formHash: string
    readonly letter: string | null
    readonly answers: ReadonlyArray<KitAnswer>
    readonly model: string | null
    readonly promptHash: string | null
    readonly costUsd: number | null
  }
): RepoEffect<KitRecord> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(applicationKit)
      .values({
        userId: input.userId,
        applicationId: input.applicationId,
        formHash: input.formHash,
        letter: input.letter,
        answers: input.answers,
        model: input.model,
        promptHash: input.promptHash,
        costUsd: input.costUsd
      })
      .onConflictDoUpdate({
        target: [applicationKit.applicationId, applicationKit.formHash],
        set: {
          letter: sql`excluded.letter`,
          answers: sql`excluded.answers`,
          model: sql`excluded.model`,
          promptHash: sql`excluded.prompt_hash`,
          costUsd: sql`excluded.cost_usd`
        }
      })
      .returning()

    return {
      id: row!.id as KitRecord["id"],
      applicationId: row!.applicationId as KitRecord["applicationId"],
      formHash: row!.formHash,
      letter: row!.letter,
      answers: row!.answers,
      model: row!.model,
      promptHash: row!.promptHash,
      costUsd: row!.costUsd,
      createdAt: row!.createdAt.toISOString()
    }
  })

export const findKit = (
  tx: Executor,
  applicationId: string,
  formHash?: string
): RepoEffect<KitRecord | null> =>
  tx
    .select()
    .from(applicationKit)
    .where(
      formHash === undefined
        ? sql`${applicationKit.applicationId} = ${applicationId}`
        : sql`${applicationKit.applicationId} = ${applicationId} and ${applicationKit.formHash} = ${formHash}`
    )
    .orderBy(sql`${applicationKit.createdAt} desc`)
    .limit(1)
    .pipe(
      Effect.map((rows) => {
        const row = rows[0]
        if (row === undefined) return null
        return {
          id: row.id as KitRecord["id"],
          applicationId: row.applicationId as KitRecord["applicationId"],
          formHash: row.formHash,
          letter: row.letter,
          answers: row.answers,
          model: row.model,
          promptHash: row.promptHash,
          costUsd: row.costUsd,
          createdAt: row.createdAt.toISOString()
        }
      })
    )

export const findKitForForm = (
  tx: Executor,
  applicationId: string,
  formHash: string
): RepoEffect<KitRecord | null> =>
  findKit(tx, applicationId, formHash)

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

const toStoredForm = (row: typeof applicationForm.$inferSelect): StoredForm => ({
  form: row.form,
  hints: row.hints,
  url: row.url,
  fetchedAt: row.createdAt.toISOString()
})

/** Stores the parsed form. Re-preparing an unchanged form refreshes its hints. */
export const saveForm = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly applicationId: string
    readonly form: ResponseForm
    readonly hints: ReadonlyArray<StoredHint>
    readonly url: string
  }
): RepoEffect<StoredForm> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(applicationForm)
      .values({
        userId: input.userId,
        applicationId: input.applicationId,
        formHash: input.form.formHash,
        layout: input.form.layout,
        form: input.form,
        hints: input.hints,
        url: input.url
      })
      .onConflictDoUpdate({
        target: [applicationForm.applicationId, applicationForm.formHash],
        set: {
          form: sql`excluded.form`,
          hints: sql`excluded.hints`,
          url: sql`excluded.url`,
          createdAt: sql`now()`
        }
      })
      .returning()
    return toStoredForm(row!)
  })

/** The newest prepared form: the one a kit must be written for. */
export const findForm = (
  tx: Executor,
  applicationId: string
): RepoEffect<StoredForm | null> =>
  tx
    .select()
    .from(applicationForm)
    .where(sql`${applicationForm.applicationId} = ${applicationId}`)
    .orderBy(sql`${applicationForm.createdAt} desc`)
    .limit(1)
    .pipe(Effect.map((rows) => (rows[0] === undefined ? null : toStoredForm(rows[0]))))

/* -------------------------------------------------------------------------- */
/* Attempts                                                                   */
/* -------------------------------------------------------------------------- */

export const listAttempts = (
  tx: Executor,
  applicationId: string
): RepoEffect<ReadonlyArray<AttemptRecord>> =>
  tx
    .select()
    .from(applicationAttempt)
    .where(sql`${applicationAttempt.applicationId} = ${applicationId}`)
    .orderBy(applicationAttempt.seq)
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id as AttemptRecord["id"],
          applicationId: row.applicationId as AttemptRecord["applicationId"],
          seq: row.seq,
          stage: row.stage as AttemptRecord["stage"],
          harnessId: row.harnessId as AttemptRecord["harnessId"],
          exit: row.exit as HarnessExit | null,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null
        }))
      )
    )

/**
 * Attempts are append-only and numbered per application. The unique
 * `(application_id, seq)` constraint is what makes a duplicate submit
 * impossible to record silently.
 */
export const appendAttempt = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly applicationId: string
    readonly stage: "prepare" | "submit" | "reconcile"
    readonly harnessId: string | null
  }
): RepoEffect<AttemptRecord> =>
  Effect.gen(function*() {
    const [row] = (
      yield* tx.execute(sql`
        insert into application_attempt (user_id, application_id, seq, stage, harness_id)
        select ${input.userId}, ${input.applicationId},
               coalesce(max(seq), 0) + 1, ${input.stage}, ${input.harnessId}
        from application_attempt
        where application_id = ${input.applicationId}
        returning *
      `)
    ).rows

    return {
      id: row!.id as AttemptRecord["id"],
      applicationId: row!.application_id as AttemptRecord["applicationId"],
      seq: row!.seq as number,
      stage: row!.stage as AttemptRecord["stage"],
      harnessId: row!.harness_id as AttemptRecord["harnessId"],
      exit: null,
      startedAt: new Date(row!.started_at as string).toISOString(),
      finishedAt: null
    }
  })

export const finishAttempt = (
  tx: Executor,
  attemptId: string,
  exit: HarnessExit,
  artifacts: Record<string, unknown> | null
): RepoEffect<void> =>
  tx.execute(sql`
    update application_attempt
    set exit = ${JSON.stringify(exit)}::jsonb,
        artifacts = ${JSON.stringify(artifacts ?? {})}::jsonb,
        finished_at = now()
    where id = ${attemptId} and finished_at is null
  `).pipe(Effect.asVoid)

const snake = (key: string): string =>
  key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)

/** The attempt a completing harness should finish, if one is still open. */
export const openAttempt = (
  tx: Executor,
  applicationId: string,
  stage: "prepare" | "submit" | "reconcile"
): RepoEffect<string | null> =>
  tx
    .select({ id: applicationAttempt.id })
    .from(applicationAttempt)
    .where(
      sql`${applicationAttempt.applicationId} = ${applicationId}
        and ${applicationAttempt.stage} = ${stage}
        and ${applicationAttempt.finishedAt} is null`
    )
    .orderBy(sql`${applicationAttempt.seq} desc`)
    .limit(1)
    .pipe(Effect.map((rows) => rows[0]?.id ?? null))
