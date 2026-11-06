import type {
  ConversationChannel,
  ConversationDetail,
  ConversationId,
  ConversationSummary,
  HhAccountId,
  ResumeId,
  VacancyChat,
  VacancyId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface ConversationListInput {
  readonly channel?: ConversationChannel
  readonly query?: string
  readonly limit?: number
}

export const conversationApi = {
  list: (input: ConversationListInput): Promise<ReadonlyArray<ConversationSummary>> =>
    call((client) => client.ConversationsList(input)),
  get: (id: string): Promise<ConversationDetail> =>
    call((client) => client.ConversationGet({ id: id as ConversationId })),
  /** The stored hh chat of a vacancy for a resume (one chat per response). */
  vacancyChat: (key: { vacancyId: string; accountId: string; resumeId: string }): Promise<VacancyChat> =>
    call((client) =>
      client.VacancyChatGet({
        vacancyId: key.vacancyId as VacancyId,
        hhAccountId: key.accountId as HhAccountId,
        resumeId: key.resumeId === "" ? null : (key.resumeId as ResumeId)
      })
    ),
  /** Queues a chat read on the harness and returns at once. */
  vacancyChatRefresh: (key: { vacancyId: string; accountId: string; resumeId: string }): Promise<VacancyChat> =>
    call((client) =>
      client.VacancyChatRefresh({
        vacancyId: key.vacancyId as VacancyId,
        hhAccountId: key.accountId as HhAccountId,
        resumeId: key.resumeId === "" ? null : (key.resumeId as ResumeId)
      })
    )
}
