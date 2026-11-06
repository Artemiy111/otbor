import type { FormAnswer, VacancyDraft, VacancyLookupItem } from "@otbor/contract"

export interface Settings {
  /** The otbor RPC endpoint (`otbor up` serves it on 3001). */
  readonly apiUrl: string
  /** The web app; used for "open in otbor" links. */
  readonly webUrl: string
  /** Save pages without being asked. */
  readonly autoCapture: boolean
  /** On a vacancy with a draft for the page's account, open hh's response form at once. */
  readonly autoOpenResponse: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: "http://127.0.0.1:3001/rpc",
  webUrl: "http://127.0.0.1:5173",
  autoCapture: true,
  autoOpenResponse: true
}

export type Request =
  | {
      readonly type: "capture"
      readonly drafts: ReadonlyArray<VacancyDraft>
      /** Run the decision for the (single) vacancy page right after saving. */
      readonly evaluate: boolean
    }
  | { readonly type: "lookup"; readonly externalIds: ReadonlyArray<string> }
  | { readonly type: "ping" }
  /** Drafts of one hh vacancy, for its response form. */
  | { readonly type: "drafts"; readonly externalId: string; readonly hhid: string | null }
  /** The operator pressed hh's button and hh confirmed. */
  | { readonly type: "record"; readonly payload: RecordPayload }

export interface RecordPayload {
  readonly kind: "submit" | "letter"
  readonly externalId: string
  readonly hhid: string | null
  readonly resumeTitle: string | null
  readonly letter: string | null
  readonly answers: ReadonlyArray<FormAnswer>
  readonly formHash: string | null
  readonly url: string
  readonly evidence: string
}

export type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export interface CaptureReply {
  readonly inserted: number
  readonly updated: number
  readonly items: ReadonlyArray<VacancyLookupItem>
}
