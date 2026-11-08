/**
 * Реестр обработчиков завершения: стадия задачи -> модуль, решающий её итог.
 * Общая рамка (аренда, запись задачи, журнал, переход заявки) - в
 * `QueueService.complete`.
 */
import type { HarnessJob } from "@otbor/contract"
import { completeFormRead } from "./formRead.ts"
import { completeInference } from "./inference.ts"
import { completeReconcile } from "./reconcile.ts"
import { completeLetterAttach, completePrepare, completeSession } from "./simple.ts"
import { completeSubmit } from "./submit.ts"
import { completeChatRead, completeNegotiationsSync, completeResumeSync } from "./syncs.ts"
import type { StageHandler } from "./types.ts"

export { exitDetail, retryLater } from "./common.ts"
export type { AppState, CompletionOptions, SettleSubmit, StageHandler, StageOutcome } from "./types.ts"
export { outcome } from "./types.ts"

export const stageHandlers: Record<HarnessJob["stage"], StageHandler> = {
  prepare: completePrepare,
  form_read: completeFormRead,
  submit: completeSubmit,
  reconcile: completeReconcile,
  negotiations_sync: completeNegotiationsSync,
  letter_attach: completeLetterAttach,
  resume_sync: completeResumeSync,
  chat_read: completeChatRead,
  session: completeSession,
  inference: completeInference
}
