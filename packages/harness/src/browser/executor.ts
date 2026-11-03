import type { HarnessExit, PrepareJobPayload, ReconcileJobPayload, SubmitJobPayload } from "@otbor/contract"
import { Context, Effect, Layer } from "effect"

/**
 * Runs hh.ru browser work for one leased job. It never fails: every problem is
 * a typed exit, because the cloud decides what happens next. Interrupting the
 * effect (lease lost, shutdown) must close the browser.
 */

export interface SubmitRequest {
  readonly payload: SubmitJobPayload
  /**
   * Called immediately before the submit button is pressed. `false` means the
   * lease is gone: the executor must not click.
   */
  readonly beforeClick: Effect.Effect<boolean>
}

export interface BrowserExecutorShape {
  readonly prepare: (payload: PrepareJobPayload) => Effect.Effect<HarnessExit>
  readonly submit: (request: SubmitRequest) => Effect.Effect<HarnessExit>
  /**
   * Reads the vacancy page and the negotiations list in the account's session
   * and returns them as evidence. It never clicks a respond control and never
   * decides whether a response exists.
   */
  readonly reconcile: (payload: ReconcileJobPayload) => Effect.Effect<HarnessExit>
}

export class BrowserExecutor extends Context.Service<BrowserExecutor, BrowserExecutorShape>()(
  "otbor/harness/BrowserExecutor"
) {
  /** An executor that answers from callbacks. For tests and dry runs. */
  static readonly fake = (handlers: Partial<BrowserExecutorShape> = {}) =>
    Layer.succeed(BrowserExecutor)(
      BrowserExecutor.of({
        prepare:
          handlers.prepare ??
          (() => Effect.succeed<HarnessExit>({ tag: "blocked", message: "fake executor: prepare" })),
        submit:
          handlers.submit ??
          (() => Effect.succeed<HarnessExit>({ tag: "blocked", message: "fake executor: submit" })),
        reconcile:
          handlers.reconcile ??
          (() => Effect.succeed<HarnessExit>({ tag: "blocked", message: "fake executor: reconcile" }))
      })
    )
}
