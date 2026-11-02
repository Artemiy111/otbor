export interface ContactListKey {
  readonly query: string
  readonly kind: string
  readonly source: string
  readonly vacancyId?: string
}

export const contactKeys = {
  all: ["contacts"] as const,
  list: (params: ContactListKey) => ["contacts", "list", params] as const,
  vacancy: (vacancyId: string) => ["contacts", "vacancy", vacancyId] as const
}
