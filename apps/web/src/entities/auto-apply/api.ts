import type {
  AutoApplyPreviewResult,
  AutoApplyProgressResult,
  AutoApplyRetryResult,
  ApplicationId,
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
  readonly applicationId?: string
}

export interface AutoApplyRetryInput {
  /** One application; left out: every retryable one of the account (or of the user). */
  readonly applicationId?: string
  readonly hhAccountId?: string
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
        activeOnly: input.activeOnly,
        applicationId: input.applicationId as ApplicationId | undefined
      })
    ),
  retry: (input: AutoApplyRetryInput): Promise<AutoApplyRetryResult> =>
    call((client) =>
      client.AutoApplyRetry({
        applicationId: input.applicationId as ApplicationId | undefined,
        hhAccountId: input.hhAccountId as HhAccountId | undefined
      })
    )
}
