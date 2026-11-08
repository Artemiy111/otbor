import type {
  ContactId,
  ContactRecord,
  PeopleRelinkResult,
  PersonId,
  PersonRecord,
  PersonSummary
} from "@otbor/contract"
import { call } from "@/shared/api"

export interface PersonListInput {
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export interface PersonListResult {
  readonly items: ReadonlyArray<PersonSummary>
  readonly total: number
}

export interface PersonUpdateInput {
  readonly name?: string | null
  readonly role?: string | null
  readonly notes?: string | null
}

export const personApi = {
  list: (input: PersonListInput): Promise<PersonListResult> =>
    call((client) => client.PersonList(input)),
  get: (id: string): Promise<PersonRecord> =>
    call((client) => client.PersonGet({ id: id as PersonId })),
  update: (id: string, input: PersonUpdateInput): Promise<PersonRecord> =>
    call((client) => client.PersonUpdate({ id: id as PersonId, ...input })),
  merge: (into: string, from: string): Promise<PersonRecord> =>
    call((client) => client.PersonMerge({ into: into as PersonId, from: from as PersonId })),
  split: (contactId: string): Promise<PersonRecord> =>
    call((client) => client.PersonSplit({ contactId: contactId as ContactId })),
  confirm: (contactId: string): Promise<ContactRecord> =>
    call((client) => client.ContactConfirm({ contactId: contactId as ContactId })),
  reject: (contactId: string): Promise<ContactRecord> =>
    call((client) => client.ContactReject({ contactId: contactId as ContactId })),
  relink: (): Promise<PeopleRelinkResult> => call((client) => client.PeopleRelink({}))
}
