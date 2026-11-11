import type {
  ApplicationDetail,
  ApplicationRecord,
  AttemptRecord,
  HarnessExit,
  KitAnswer,
  KitRecord,
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { application, applicationAttempt, applicationKit } from "../db/tables.ts"
import * as ApplyFilterRepository from "./ApplyFilterRepository.ts"

export const APPLICABLE_STATES = ["draft", "needs_human", "failed"] as const

/** Сколько автоповторов получает транзиентная остановка автоотклика до `needs_human`. */
export const MAX_AUTO_RETRIES = 3

/** Ожидание перед автоповтором n-го по счёту (0, 1, 2): 1 ч, 4 ч, 12 ч. */
export const AUTO_RETRY_BACKOFF_MS = [1, 4, 12].map((hours) => hours * 3_600_000) as ReadonlyArray<number>

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
  readonly auto_run?: string | null
  readonly blocked_reason?: string | null
  readonly retry_at?: Date | null
  readonly auto_retries?: number
  readonly has_letter?: boolean | null
  readonly created_at: Date
  readonly updated_at: Date
}

const selection = sql`
  select a.*, v.title as vacancy_title, e.name as employer_name,
    -- Есть ли в последнем ките непустое письмо; null, пока кита нет.
    (select k.letter is not null and btrim(k.letter) <> ''
       from application_kit k where k.application_id = a.id
       order by k.created_at desc limit 1) as has_letter
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
  autoRun: (row.auto_run ?? null) as ApplicationRecord["autoRun"],
  blockedReason: (row.blocked_reason ?? null) as ApplicationRecord["blockedReason"],
  retryAt: row.retry_at == null ? null : new Date(row.retry_at).toISOString(),
  autoRetries: row.auto_retries ?? 0,
  hasLetter: row.has_letter ?? null,
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
    readonly state: "draft" | "preparing"
    /** Only AutoApplyRunner sets this; it marks the row as the runner's to progress. */
    readonly autoRun?: "drafts" | "auto"
  }
): RepoEffect<{ readonly record: ApplicationRecord; readonly created: boolean }> =>
  Effect.gen(function*() {
    // No resume named: reuse whatever application the account already has for
    // this vacancy, so a retry never makes a second, resume-less row.
    if (input.resumeId === null) {
      const [existing] = yield* tx
        .select({ id: application.id })
        .from(application)
        .where(
          sql`${application.hhAccountId} = ${input.hhAccountId} and ${application.vacancyId} = ${input.vacancyId}`
        )
        .orderBy(sql`${application.createdAt} asc`)
        .limit(1)
      if (existing !== undefined) {
        const found = yield* find(tx, input.userId, existing.id)
        return { record: found!.application, created: false }
      }
    }

    const inserted = yield* tx
      .insert(application)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        vacancyId: input.vacancyId,
        resumeId: input.resumeId,
        streamId: input.streamId,
        decisionId: input.decisionId,
        state: input.state,
        autoRun: input.autoRun ?? null
      })
      .onConflictDoNothing({
        target: [application.hhAccountId, application.vacancyId, application.resumeId]
      })
      .returning({ id: application.id })

    const id =
      inserted[0]?.id ??
      (yield* tx
        .select({ id: application.id })
        .from(application)
        .where(
          sql`${application.hhAccountId} = ${input.hhAccountId}
            and ${application.vacancyId} = ${input.vacancyId}
            and ${application.resumeId} is not distinct from ${input.resumeId}`
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
    const attempts = yield* listAttempts(tx, id)

    return { application: record, kit, form: null, attempts }
  })

export const list = (
  tx: Executor,
  userId: string,
  options: {
    readonly state?: string
    readonly hhAccountId?: string
    readonly vacancyId?: string
    readonly limit?: number
  } = {}
): RepoEffect<ReadonlyArray<ApplicationRecord>> =>
  tx
    .execute(sql`
      ${selection}
      where a.user_id = ${userId}
        ${options.state === undefined || options.state === ""
          ? sql``
          : sql`and a.state = ${options.state}`}
        ${options.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${options.hhAccountId}`}
        ${options.vacancyId === undefined ? sql`` : sql`and a.vacancy_id = ${options.vacancyId}`}
      order by a.updated_at desc
      limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<ApplicationRow>).map(toRecord)
      )
    )

export interface SearchOptions {
  readonly states?: ReadonlyArray<string>
  readonly hhAccountId?: string
  readonly blockedReason?: string
  readonly mode?: "manual" | "drafts" | "auto" | "any_auto"
  readonly search?: string
  readonly limit?: number
  readonly offset?: number
}

/** Подстрока для `ilike`: служебные символы шаблона экранируются. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/**
 * Страница откликов с настоящим итогом и счётчиками по состояниям. Счётчики
 * считаются только по аккаунту: это вкладки страницы, и фильтр причины или
 * поиск не должны менять их.
 */
export const search = (
  tx: Executor,
  userId: string,
  options: SearchOptions = {}
): RepoEffect<{
  readonly items: ReadonlyArray<ApplicationRecord>
  readonly total: number
  readonly byState: Readonly<Record<string, number>>
}> =>
  Effect.gen(function*() {
    const states = options.states ?? []
    const text = options.search?.trim() ?? ""
    const where = sql`
      a.user_id = ${userId}
        ${options.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${options.hhAccountId}`}
        ${states.length === 0
          ? sql``
          : sql`and a.state in (${sql.join(states.map((state) => sql`${state}`), sql`, `)})`}
        ${options.blockedReason === undefined || options.blockedReason === ""
          ? sql``
          : sql`and a.blocked_reason = ${options.blockedReason}`}
        ${options.mode === undefined
          ? sql``
          : options.mode === "manual"
          ? sql`and a.auto_run is null`
          : options.mode === "any_auto"
          ? sql`and a.auto_run is not null`
          : sql`and a.auto_run = ${options.mode}`}
        ${text === ""
          ? sql``
          : sql`and (v.title ilike ${likePattern(text)} escape '\\' or e.name ilike ${likePattern(text)} escape '\\')`}
    `
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const offset = Math.max(options.offset ?? 0, 0)
    const rows = (yield* tx.execute(sql`
      ${selection}
      where ${where}
      order by a.updated_at desc, a.id desc
      limit ${limit} offset ${offset}
    `)).rows as unknown as ReadonlyArray<ApplicationRow>
    const [totalRow] = (yield* tx.execute(sql`
      select count(*)::int as total
      from application a
      join vacancy v on v.id = a.vacancy_id
      left join employer e on e.id = v.employer_id
      where ${where}
    `)).rows as unknown as ReadonlyArray<{ readonly total: number }>
    const counted = (yield* tx.execute(sql`
      select a.state, count(*)::int as n
      from application a
      where a.user_id = ${userId}
        ${options.hhAccountId === undefined ? sql`` : sql`and a.hh_account_id = ${options.hhAccountId}`}
      group by a.state
    `)).rows as unknown as ReadonlyArray<{ readonly state: string; readonly n: number }>
    return {
      items: rows.map(toRecord),
      total: totalRow?.total ?? 0,
      byState: Object.fromEntries(counted.map((row) => [row.state, row.n]))
    }
  })

/**
 * Transition with an explicit guard, so a stale actor cannot resurrect a submit.
 *
 * Причина остановки (`blocked_reason`, `retry_at`) идёт вместе с состоянием:
 * без явного `blockedReason` в `patch` переход в `needs_human` / `failed` ставит
 * код `operator`, любой другой переход (approve, retry, claim, skip) снимает
 * причину и время повтора.
 */
export const transition = (
  tx: Executor,
  userId: string,
  id: string,
  to: ApplicationRecord["state"],
  guard: { readonly from: ReadonlyArray<ApplicationRecord["state"]>; readonly patch?: Record<string, unknown> }
): RepoEffect<ApplicationRecord | null> =>
  Effect.gen(function*() {
    const from = sql.join(guard.from.map((state) => sql`${state}`), sql`, `)
    const given = guard.patch ?? {}
    const patch: Record<string, unknown> =
      "blockedReason" in given
        ? { retryAt: null, ...given }
        : {
            ...given,
            blockedReason: to === "needs_human" || to === "failed" ? "operator" : null,
            ...("retryAt" in given ? {} : { retryAt: null })
          }
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

/**
 * Whether the account already applied to the vacancy with this resume. An
 * application whose resume is unknown (imported from hh) counts for every
 * resume; with no resume asked about, any application counts.
 */
export const existsForVacancy = (
  tx: Executor,
  hhAccountId: string,
  vacancyId: string,
  resumeId: string | null = null
): RepoEffect<boolean> =>
  tx
    .select({ id: application.id })
    .from(application)
    .where(
      resumeId === null
        ? sql`${application.hhAccountId} = ${hhAccountId} and ${application.vacancyId} = ${vacancyId}`
        : sql`${application.hhAccountId} = ${hhAccountId} and ${application.vacancyId} = ${vacancyId}
            and (${application.resumeId} = ${resumeId} or ${application.resumeId} is null)`
    )
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

/**
 * Auto applications of one account that already hold (or will hold) a daily
 * slot but have not claimed it yet: `preparing` (form, letter or kit still
 * missing, or waiting for a retry). The runner and its preview subtract them from the budget in `auto`.
 */
export const pendingAutoSlots = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): RepoEffect<number> =>
  tx
    .execute(sql`
      select count(*)::int as n from application
      where user_id = ${userId} and hh_account_id = ${hhAccountId}
        and auto_run = 'auto' and state = 'preparing'
        and ${ApplyFilterRepository.governingAutoModeSql("application")} = 'auto'
    `)
    .pipe(Effect.map((result) => Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0)))

/**
 * Автоотклики аккаунта, которые ждут в `preparing` кит или форму, но чья
 * управляющая строка apply filter больше не `auto`: они возвращаются в `draft`
 * с причиной, их никто не отправит, и они перестают резервировать слоты.
 * Возвращает, сколько строк сдвинуто. Вызывать в транзакции, менявшей режим.
 */
export const demoteUngovernedAuto = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): RepoEffect<number> =>
  tx
    .execute(sql`
      update application a
      set state = 'draft', last_error = 'auto mode was turned off; nothing was sent',
          blocked_reason = null, retry_at = null, updated_at = now()
      where a.user_id = ${userId} and a.hh_account_id = ${hhAccountId}
        and a.auto_run = 'auto' and a.state = 'preparing'
        and ${ApplyFilterRepository.governingAutoModeSql("a")} <> 'auto'
      returning a.id
    `)
    .pipe(Effect.map((result) => result.rows.length))


/** Заявка, которую раннер автооткликов ведёт дальше. */
export interface RunnerApplicationRow {
  readonly id: string
  readonly vacancyId: string
  readonly resumeId: string | null
  readonly hhAccountId: string
  readonly autoRun: "drafts" | "auto"
}

interface RunnerRawRow {
  readonly id: string
  readonly vacancy_id: string
  readonly resume_id: string | null
  readonly hh_account_id: string
  readonly auto_run: "drafts" | "auto"
}

/**
 * Автозаявки аккаунта, которые ещё ждут раннера: `auto` в `preparing` (и
 * дождавшиеся `retry_at`) и `drafts` в `draft` без кита. `onlyIds` сужает выбор
 * до перечисленных заявок, условия остаются теми же.
 */
/**
 * Черновики (`auto_run` `drafts` или `auto` после выключенного режима; ручные
 * не трогаем), чья пара (аккаунт, резюме) теперь в режиме `auto`, становятся
 * автооткликами: `auto_run = 'auto'`, `preparing`. Вакансию, на которую у
 * аккаунта уже есть отправленный отклик, не трогаем.
 * Заявки `needs_human` не трогаем: им нужен явный повтор оператора.
 * Возвращает число переведённых заявок.
 */
export const promoteDraftsToAuto = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): RepoEffect<number> =>
  tx
    .execute(sql`
      update application
      set auto_run = 'auto', state = 'preparing', last_error = null,
          blocked_reason = null, retry_at = null, auto_retries = 0, updated_at = now()
      where user_id = ${userId} and hh_account_id = ${hhAccountId}
        and auto_run in ('drafts', 'auto') and state = 'draft'
        and ${ApplyFilterRepository.governingAutoModeSql("application")} = 'auto'
        -- Уже сделанный на hh отклик не воскрешаем: черновик не должен уйти дублем.
        and not exists (
          select 1 from application o
          where o.hh_account_id = application.hh_account_id and o.vacancy_id = application.vacancy_id
            and o.id <> application.id and o.state = 'submitted'
        )
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length))

/**
 * Заявки на вакансии, которые hh перевёл в архив: отправлять некуда, ошибка
 * формы или отправки здесь вторична. Снимаем их (`skipped`) с понятной причиной.
 * `queued`/`submitting` не трогаем: у них идёт задача. Возвращает число заявок.
 */
export const skipArchivedVacancies = (
  tx: Executor,
  userId: string,
  hhAccountId: string
): RepoEffect<number> =>
  tx
    .execute(sql`
      update application a
      set state = 'skipped', blocked_reason = null, retry_at = null,
          last_error = 'вакансия в архиве hh; отклик не нужен', updated_at = now()
      from vacancy v
      where v.id = a.vacancy_id and v.archived
        and a.user_id = ${userId} and a.hh_account_id = ${hhAccountId}
        and a.origin = 'otbor'
        and a.state in ('draft', 'preparing', 'needs_human', 'failed')
      returning a.id
    `)
    .pipe(Effect.map((result) => result.rows.length))

export const listOwnedByRunner = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly limit: number
    readonly onlyIds?: ReadonlyArray<string> | undefined
  }
): RepoEffect<ReadonlyArray<RunnerApplicationRow>> =>
  tx
    .execute(sql`
      select id, vacancy_id, resume_id, hh_account_id, auto_run
      from application
      where user_id = ${input.userId} and hh_account_id = ${input.hhAccountId}
        and auto_run is not null
        and ((auto_run = 'auto' and state = 'preparing'
            and (retry_at is null or retry_at <= now())
            -- Ждёт оператора после капчи: раннер её не трогает, пока блокировка стоит.
            and (blocked_reason is distinct from 'captcha'
              or not exists (select 1 from hh_account a
                              where a.id = application.hh_account_id and a.submit_blocked_at is not null)))
          or (auto_run = 'drafts' and state = 'draft'
            and not exists (select 1 from application_kit k where k.application_id = application.id)))
        ${
          input.onlyIds === undefined
            ? sql``
            : input.onlyIds.length === 0
              ? sql`and false`
              : sql`and id in (${sql.join(input.onlyIds.map((id) => sql`${id}::uuid`), sql`, `)})`
        }
      order by created_at asc
      limit ${input.limit}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<RunnerRawRow>).map(
          (row): RunnerApplicationRow => ({
            id: row.id,
            vacancyId: row.vacancy_id,
            resumeId: row.resume_id,
            hhAccountId: row.hh_account_id,
            autoRun: row.auto_run
          })
        )
      )
    )

/** Уже есть заявка на эту вакансию с этим резюме (кроме самой `exceptId`). */
export const resumeClashExists = (
  tx: Executor,
  input: { readonly hhAccountId: string; readonly vacancyId: string; readonly resumeId: string; readonly exceptId: string }
): RepoEffect<boolean> =>
  tx
    .execute(sql`
      select 1 from application
      where hh_account_id = ${input.hhAccountId} and vacancy_id = ${input.vacancyId}
        and resume_id = ${input.resumeId} and id <> ${input.exceptId}
      limit 1
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Дозаполняет резюме у автозаявки, у которой оно ещё NULL. */
export const backfillResume = (
  tx: Executor,
  input: { readonly userId: string; readonly id: string; readonly resumeId: string }
): RepoEffect<void> =>
  tx
    .execute(sql`
      update application set resume_id = ${input.resumeId}, updated_at = now()
      where id = ${input.id} and user_id = ${input.userId}
        and auto_run is not null and resume_id is null
    `)
    .pipe(Effect.asVoid)

/**
 * Снимает причину ожидания и `retry_at` у `preparing`-заявки: раннер идёт
 * дальше. Только если срок вышел (или не был задан); возвращает, снято ли.
 */
export const clearPreparingBlock = (tx: Executor, userId: string, id: string): RepoEffect<boolean> =>
  tx
    .execute(sql`
      update application set blocked_reason = null, retry_at = null, updated_at = now()
      where id = ${id} and user_id = ${userId} and state = 'preparing'
        and (retry_at is null or retry_at <= now())
      returning id
    `)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Срок ожидания заявки вышел (или не был задан), по часам базы. */
export const retryDue = (tx: Executor, id: string): RepoEffect<boolean> =>
  tx
    .execute(sql`select (retry_at is null or retry_at <= now()) as due from application where id = ${id}`)
    .pipe(Effect.map((result) => (result.rows[0] as { due?: boolean } | undefined)?.due !== false))

/** Препятствие снято: бюджет автоповторов (3) начинается заново. */
export const resetAutoRetries = (tx: Executor, userId: string, id: string): RepoEffect<void> =>
  tx
    .execute(sql`
      update application set auto_retries = 0
      where id = ${id} and user_id = ${userId} and auto_retries <> 0
    `)
    .pipe(Effect.asVoid)

/**
 * Чтение формы удалось: заявки, ждавшие повтора после `form_read_failed`,
 * освобождаются от ожидания, а счётчик автоповторов обнуляется.
 */
export const clearFormReadBlock = (
  tx: Executor,
  userId: string,
  ids: ReadonlyArray<string>
): RepoEffect<void> =>
  ids.length === 0
    ? Effect.void
    : tx
        .execute(sql`
          update application
          set blocked_reason = null, retry_at = null, auto_retries = 0, updated_at = now()
          where user_id = ${userId} and state = 'preparing' and blocked_reason = 'form_read_failed'
            and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        `)
        .pipe(Effect.asVoid)

/**
 * Есть ли у аккаунта другая заявка (любого состояния и происхождения) на ту же
 * вакансию с другим резюме. Тогда страница вакансии, которая показывает «вы
 * откликнулись», не говорит, чей это отклик. Заявка без резюме ничего не
 * различает, ей список не нужен.
 */
export const hasOtherResumeApplication = (tx: Executor, applicationId: string): RepoEffect<boolean> =>
  tx
    .execute(sql`
      select exists (
        select 1
        from application a
        join application o
          on o.hh_account_id = a.hh_account_id and o.vacancy_id = a.vacancy_id and o.id <> a.id
        where a.id = ${applicationId}
          and a.resume_id is not null
          and o.resume_id is distinct from a.resume_id
      ) as other
    `)
    .pipe(Effect.map((result) => (result.rows[0] as { other?: boolean } | undefined)?.other === true))

/**
 * Заявки, которые остановила капча: ждут оператора (`needs_human`) или упали
 * (`failed`) с причиной про капчу. Только заявки пользователя, при необходимости
 * одного аккаунта.
 */
export const captchaStoppedIds = (
  tx: Executor,
  userId: string,
  hhAccountId?: string | undefined
): RepoEffect<ReadonlyArray<string>> =>
  tx
    .execute(sql`
      select id from application
      where user_id = ${userId}
        and state in ('needs_human', 'failed')
        and (last_error ilike '%captcha%' or blocked_reason in ('captcha', 'form_read_failed'))
        ${hhAccountId === undefined ? sql`` : sql`and hh_account_id = ${hhAccountId}::uuid`}
      order by updated_at
    `)
    .pipe(Effect.map((result) => (result.rows as ReadonlyArray<{ id: string }>).map((row) => String(row.id))))
