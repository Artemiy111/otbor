/**
 * Единственный шлюз, через который в очередь попадает отправка отклика на hh.
 *
 * Через него идут все пути: одобрение оператором (`ApplicationService.approve`),
 * сохранение кита у автоотклика (`setKit`), завершение `form_read`
 * (`QueueService`) и раннер автооткликов. Шлюз сам читает сохранённую форму
 * вакансии и кит под её хеш, проверяет кит, свежесть формы, режим auto,
 * at-most-once и дневной лимит, занимает слот (`intent_at`) и ставит ровно одну
 * submit-задачу. Результат - размеченный итог, а не исключение.
 */
import type { ApplicationRecord, KitRecord, ResponseForm } from "@otbor/contract"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { FORM_TTL_MS } from "../repositories/VacancyFormRepository.ts"
import { checkKit, type KitProblem } from "./applyRules.ts"
import { DAY_MS, dailyLimitFor, lockAccountSlots, recentSubmits } from "./dailyLimit.ts"
import { nextSequence, submitJob, targetFor } from "./jobs.ts"
import { currentFormFor } from "./vacancyForm.ts"

/** Кто просит отправку: оператор (`approve`) или автоотклик (`auto`). */
export type SubmitTrigger = "approve" | "auto"

/** Чего не хватает, чтобы отправлять: заявка остаётся как есть и ждёт. */
export type NotReadyReason = "no_form" | "stale_form" | "no_kit"

/** Почему отправка запрещена. */
export type RefusedReason =
  | "already_submitted"
  | "in_flight"
  | "state"
  | "submit_attempted"
  | "submit_exists"
  | "kit_refused"
  | "not_auto"
  | "auto_off"
  | "no_vacancy"

export type SubmitOutcome =
  /** Слот занят, submit-задача поставлена (`jobQueued`) или уже шла (`jobQueued: false`). */
  | {
      readonly _tag: "queued"
      readonly application: ApplicationRecord
      readonly kit: KitRecord
      readonly form: ResponseForm
      readonly jobQueued: boolean
    }
  /** Нет формы, она устарела или нет кита под неё: ничего не менялось. */
  | { readonly _tag: "not_ready"; readonly reason: NotReadyReason; readonly message: string }
  /** Отправка запрещена; `problems` заполнено только для `kit_refused`. */
  | {
      readonly _tag: "refused"
      readonly reason: RefusedReason
      readonly message: string
      readonly problems: ReadonlyArray<KitProblem>
    }
  /**
   * Упёрлись в дневной лимит. Для `auto` заявка уже переведена в `needs_human`
   * с причиной; для `approve` ничего не менялось.
   */
  | {
      readonly _tag: "parked"
      readonly message: string
      readonly limit: number
      readonly used: number
      readonly resetsAt: string
    }

export interface SubmitGateInput {
  readonly userId: string
  readonly application: ApplicationRecord
  readonly trigger: SubmitTrigger
  /** Лимит, если у аккаунта нет своей строки apply filter. */
  readonly fallbackLimit: number
}

const refused = (reason: RefusedReason, message: string, problems: ReadonlyArray<KitProblem> = []): SubmitOutcome => ({
  _tag: "refused",
  reason,
  message,
  problems
})

const notReady = (reason: NotReadyReason, message: string): SubmitOutcome => ({ _tag: "not_ready", reason, message })

const APPROVABLE = ["draft", "needs_human", "failed"] as const

/**
 * Ставит отправку отклика в очередь, если все условия выполнены. Вызывать
 * внутри транзакции: шлюз берёт advisory-блокировку аккаунта до конца этой
 * транзакции, поэтому подсчёт лимита и захват слота не гоняются между собой.
 *
 * `trigger: "auto"` отправляет только `queued` заявку с `auto_run = 'auto'`,
 * чья управляющая строка apply filter сейчас в режиме `auto`.
 * `trigger: "approve"` переводит draft / needs_human / failed в `queued`.
 */
export const trySubmit = Effect.fnUntraced(function*(
  tx: Executor,
  input: SubmitGateInput
): Effect.fn.Return<SubmitOutcome, DatabaseError> {
  const { application, trigger } = input

  if (application.state === "submitted") return refused("already_submitted", "already submitted")
  if (application.state === "submitting") {
    return refused("in_flight", "submit is in flight; reconcile instead of approving again")
  }

  if (trigger === "auto") {
    // Заявки без auto_run (сделанные руками) автоотправка не трогает никогда.
    if (application.autoRun !== "auto") {
      return refused("not_auto", "the application is not an auto application; only an operator sends it")
    }
    if (application.state !== "queued") {
      return refused("state", `cannot auto-submit from state ${application.state}`)
    }
    const mode = yield* ApplyFilterRepository.governingAutoMode(
      tx,
      input.userId,
      application.hhAccountId,
      application.resumeId ?? null
    )
    if (mode !== "auto") return refused("auto_off", `auto mode is ${mode}; nothing is sent automatically`)
  } else if (!(APPROVABLE as ReadonlyArray<string>).includes(application.state)) {
    return refused("state", `cannot approve from state ${application.state}`)
  }

  const stored = yield* currentFormFor(tx, application)
  if (stored === null) {
    return notReady("no_form", "the form has not been read yet; refresh the vacancy form first")
  }
  // Кит писался под форму, которая могла измениться. Суточной давности чтению
  // для необратимой отправки не доверяем; сама отправка ещё раз сверит хеш живой формы.
  if (Date.now() - Date.parse(stored.fetchedAt) > FORM_TTL_MS) {
    return notReady("stale_form", "the stored form is older than a day; refresh the vacancy form first")
  }
  const kit = yield* ApplicationRepository.findKit(tx, application.id, stored.form.formHash)
  if (kit === null) return notReady("no_kit", "there is no kit for the current form; set a kit first")

  // Жёсткие подсказки, обязательные вопросы, задачи с кодом и помеченные
  // ответы проверяются до того, как что-либо встанет в очередь.
  const problems = checkKit({ form: stored.form, hints: stored.hints, kit })
  if (problems.length > 0) {
    return refused("kit_refused", `kit refused: ${problems.map((problem) => problem.code).join(", ")}`, problems)
  }

  // At-most-once: пока есть submit-задача, шлюз может её только заметить.
  // Терминальный сбой значит «разберись руками» (reconcile), а не «кликни ещё
  // раз». Исключение - отправка, про которую харнесс доказал, что клика не
  // было (`clicked: false`): новая задача получает свой ключ.
  const existing = yield* QueueRepository.latestFor(tx, application.id, ["submit"])
  const unsent =
    existing !== null &&
    (existing.status === "failed" || existing.status === "needs_human") &&
    (existing.result as { clicked?: unknown } | null)?.clicked === false
  if (existing !== null && !unsent) {
    if (trigger === "auto") return refused("submit_exists", `a submit job already exists (${existing.status})`)
    if (
      existing.status === "failed" ||
      existing.status === "dead" ||
      existing.status === "needs_human" ||
      existing.status === "needs_reconcile" ||
      existing.status === "done"
    ) {
      return refused(
        "submit_attempted",
        `submit was already attempted (${existing.status}); reconcile, do not resubmit`
      )
    }
  }

  const target = yield* targetFor(tx, application)
  if (target === null) return refused("no_vacancy", `vacancy ${application.vacancyId} is gone`)

  // Жёсткий лимит на аккаунт за скользящие 24 часа: считаем все отклики
  // аккаунта и занимаем слот под одной блокировкой.
  yield* lockAccountSlots(tx, application.hhAccountId)
  const recent = yield* recentSubmits(tx, application.hhAccountId, application.id)
  const limit = yield* dailyLimitFor(tx, input.userId, application.hhAccountId, input.fallbackLimit)
  if (recent.used >= limit) {
    const resetsAt = new Date((recent.oldest?.getTime() ?? Date.now()) + DAY_MS).toISOString()
    const message = `daily limit ${limit} reached; a slot frees at ${resetsAt}`
    if (trigger === "auto") {
      yield* ApplicationRepository.transition(tx, input.userId, application.id, "needs_human", {
        from: ["queued"],
        patch: { lastError: message }
      })
    }
    return { _tag: "parked", message, limit, used: recent.used, resetsAt }
  }

  const updated = yield* ApplicationRepository.transition(tx, input.userId, application.id, "queued", {
    from: trigger === "auto" ? ["queued"] : [...APPROVABLE],
    patch: { intentAt: new Date(), lastError: null }
  })
  if (updated === null) return refused("state", `cannot submit from state ${application.state}`)

  const jobQueued = existing === null || unsent
  if (jobQueued) {
    yield* submitJob(tx, {
      ...target,
      kit,
      form: stored.form,
      sequence: yield* nextSequence(tx, application.id, "submit")
    })
  }
  return { _tag: "queued", application: updated, kit, form: stored.form, jobQueued }
})
