/**
 * Общие типы обработчиков завершения задач очереди.
 *
 * `QueueService.complete` держит общую рамку (аутентификация, аренда, запись
 * итога задачи, журнал попытки, переход заявки, последующие шаги), а решение
 * «что стало с задачей и заявкой» для каждой стадии принимает отдельный
 * обработчик. Обработчик работает в той же транзакции и возвращает
 * `StageOutcome`; сам итог задачи и переход заявки применяет рамка.
 */
import type { HarnessExit, JobStatus } from "@otbor/contract"
import type { DatabaseError, Executor } from "../../db/Database.ts"
import type { JobContext } from "../../repositories/QueueRepository.ts"
import type { Effect } from "effect"

/** Состояния заявки, в которые может перевести завершение задачи. */
export type AppState =
  | "draft"
  | "preparing"
  | "queued"
  | "submitting"
  | "submitted"
  | "skipped"
  | "needs_human"
  | "failed"

/** Как закрыть припаркованную submit-задачу, когда заявка сдвинулась (сверка). */
export interface SettleSubmit {
  readonly status: "done" | "failed"
  readonly result: unknown
  readonly message: string
}

export interface StageOutcome {
  /** Итоговый статус самой задачи. */
  readonly status: JobStatus
  readonly message: string | null
  /** Когда повторить задачу (для `pending`); `undefined` - не менять. */
  readonly runAt?: Date | null | undefined
  /** В какое состояние перевести заявку задачи; `null` - не трогать. */
  readonly appState: AppState | null
  readonly appPatch: Record<string, unknown>
  /** Какую задачу поставить следом. */
  readonly enqueue: "reconcile" | "submit" | null
  readonly jobResult?: unknown
  /** Сверка: что прочитало облако, хранится в попытке вместо страниц. */
  readonly reconcileKept: Record<string, unknown> | null
  /** Сверка: чем закрыть припаркованную submit-задачу после перехода заявки. */
  readonly settle: SettleSubmit | null
  /**
   * Автозаявки, которые раннер должен сдвинуть, как только транзакция
   * завершения закоммитится (форма прочитана, письмо готово).
   */
  readonly advance: ReadonlyArray<string>
}

/** Итог с значениями по умолчанию: заявку не трогать, ничего не ставить следом. */
export const outcome = (
  status: JobStatus,
  message: string | null,
  rest: Partial<Omit<StageOutcome, "status" | "message">> = {}
): StageOutcome => ({
  status,
  message,
  appState: null,
  appPatch: {},
  enqueue: null,
  reconcileKept: null,
  settle: null,
  advance: [],
  ...rest
})

export interface CompletionOptions {
  /** Дневной лимит отправок, если у аккаунта нет строки apply filter. */
  readonly dailyApplyLimit: number
}

export type StageHandler = (
  tx: Executor,
  ctx: JobContext,
  exit: HarnessExit,
  options: CompletionOptions
) => Effect.Effect<StageOutcome, DatabaseError>
