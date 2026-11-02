import type {
  ContactId,
  ContactKind,
  ContactRecord,
  ContactSource,
  VacancyId
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface ContactListInput {
  readonly query?: string
  readonly kind?: ContactKind
  readonly source?: ContactSource
  readonly vacancyId?: string
  readonly limit?: number
  readonly offset?: number
}

export interface ContactListResult {
  readonly items: ReadonlyArray<ContactRecord>
  readonly total: number
}

export interface ContactRemoveResult {
  readonly id: ContactId
  readonly deleted: boolean
}

export interface ContactsExtractResult {
  readonly scanned: number
  readonly contacts: number
}

export const contactApi = {
  list: (input: ContactListInput): Promise<ContactListResult> =>
    call((client) =>
      client.ContactsList({
        ...input,
        vacancyId: input.vacancyId as VacancyId | undefined
      })
    ),
  remove: (id: string): Promise<ContactRemoveResult> =>
    call((client) => client.ContactRemove({ id: id as ContactId })),
  extract: (): Promise<ContactsExtractResult> =>
    call((client) => client.ContactsExtract())
}
