import type { VacancyDraft, VacancyLookupItem } from "@otbor/contract"

export interface Settings {
  /** The otbor RPC endpoint (`otbor up` serves it on 3001). */
  readonly apiUrl: string
  /** The web app; used for "open in otbor" links. */
  readonly webUrl: string
  /** Save pages without being asked. */
  readonly autoCapture: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: "http://127.0.0.1:3001/rpc",
  webUrl: "http://127.0.0.1:5173",
  autoCapture: true
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

export type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export interface CaptureReply {
  readonly inserted: number
  readonly updated: number
  readonly items: ReadonlyArray<VacancyLookupItem>
}
