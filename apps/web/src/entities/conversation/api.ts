import type {
  ConversationChannel,
  ConversationDetail,
  ConversationId,
  ConversationSummary
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
    call((client) => client.ConversationGet({ id: id as ConversationId }))
}
