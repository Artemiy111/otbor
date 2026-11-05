import type {
  AutoApplyPreviewResult,
  AutoApplyProgressResult,
  HhAccountId,
  ResumeId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface AutoApplyPreviewInput {
  readonly hhAccountId: string
  /** Omitted or null: every resume of the account. */
  readonly resumeId?: string | null
}

export interface AutoApplyProgressInput {
  readonly hhAccountId?: string
  readonly limit?: number
  readonly activeOnly?: boolean
}

export const autoApplyApi = {
  preview: (input: AutoApplyPreviewInput): Promise<AutoApplyPreviewResult> =>
    call((client) =>
      client.AutoApplyPreview({
        hhAccountId: input.hhAccountId as HhAccountId,
        resumeId: (input.resumeId ?? undefined) as ResumeId | undefined
      })
    ),
  progress: (input: AutoApplyProgressInput): Promise<AutoApplyProgressResult> =>
    call((client) =>
      client.AutoApplyProgress({
        hhAccountId: input.hhAccountId as HhAccountId | undefined,
        limit: input.limit,
        activeOnly: input.activeOnly
      })
    )
}
