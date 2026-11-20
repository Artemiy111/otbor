import type { ChatReadJobPayload, ResumeBumpJobPayload, FormReadJobPayload, LetterAttachJobPayload, RunnerExit, NegotiationsSyncJobPayload, ResumeSyncJobPayload, ReconcileJobPayload, SubmitJobPayload } from "@otbor/contract"
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
   * lease is gone: the driver must not click.
   */
  readonly beforeClick: Effect.Effect<boolean>
}

export interface LetterAttachRequest {
  readonly payload: LetterAttachJobPayload
  /** Called immediately before the send button is pressed; `false` means do not click. */
  readonly beforeClick: Effect.Effect<boolean>
}

export interface ResumeBumpRequest {
  readonly payload: ResumeBumpJobPayload
  /** Called immediately before the bump button is pressed; `false` means do not click. */
  readonly beforeClick: Effect.Effect<boolean>
}

export interface BrowserDriverShape {
  readonly prepare: (payload: FormReadJobPayload) => Effect.Effect<RunnerExit>
  readonly submit: (request: SubmitRequest) => Effect.Effect<RunnerExit>
  /** Adds a cover letter to a response hh already holds. Sends at most once. */
  readonly attachLetter: (request: LetterAttachRequest) => Effect.Effect<RunnerExit>
  /**
   * Reads the vacancy page and the negotiations list in the account's session
   * and returns them as evidence. It never clicks a respond control and never
   * decides whether a response exists.
   */
  readonly reconcile: (payload: ReconcileJobPayload) => Effect.Effect<RunnerExit>
  /**
   * Reads the negotiations list pages 0..N in the account's session and returns
   * them as evidence. Navigation only; the cloud parses and imports.
   */
  readonly negotiationsSync: (payload: NegotiationsSyncJobPayload) => Effect.Effect<RunnerExit>
  /**
   * Reads the profile page and each resume page in the account's session and
   * returns them as evidence. Navigation only; the cloud parses and stores.
   */
  readonly resumeSync: (payload: ResumeSyncJobPayload) => Effect.Effect<RunnerExit>
  /**
   * Fetches the JSON of one hh chat with the account's cookies. No page is
   * navigated and nothing is clicked; the cloud parses the body.
   */
  readonly chatRead: (payload: ChatReadJobPayload) => Effect.Effect<RunnerExit>
  /**
   * Opens the resume page and presses "Поднять в поиске" at most once, only when
   * the real button is there. Returns what the card said before and after.
   */
  readonly resumeBump: (request: ResumeBumpRequest) => Effect.Effect<RunnerExit>
}

export class BrowserDriver extends Context.Service<BrowserDriver, BrowserDriverShape>()(
  "otbor/runner/BrowserDriver"
) {
  /** Драйвер, который отвечает через колбэки. Для тестов и сухого прогона. */
  static readonly fake = (handlers: Partial<BrowserDriverShape> = {}) =>
    Layer.succeed(BrowserDriver)(
      BrowserDriver.of({
        prepare:
          handlers.prepare ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: prepare" })),
        submit:
          handlers.submit ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: submit" })),
        attachLetter:
          handlers.attachLetter ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: attach letter" })),
        reconcile:
          handlers.reconcile ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: reconcile" })),
        negotiationsSync:
          handlers.negotiationsSync ??
          (() =>
            Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: negotiations sync" })),
        resumeSync:
          handlers.resumeSync ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: resume sync" })),
        chatRead:
          handlers.chatRead ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: chat read" })),
        resumeBump:
          handlers.resumeBump ??
          (() => Effect.succeed<RunnerExit>({ tag: "blocked", message: "fake driver: resume bump" }))
      })
    )
}
