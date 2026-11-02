/**
 * Hash routes are the only URLs this app publishes. Detail pages keep the
 * parent sidebar item active, so every link is built here and nowhere else.
 */
export const vacancyPath = (id: string): string => `#/vacancies/${encodeURIComponent(id)}`

export const companyPath = (id: string): string => `#/companies/${encodeURIComponent(id)}`

export const applicationPath = (id: string): string => `#/applications/${encodeURIComponent(id)}`

export const decisionsPath = (): string => "#/decisions"

export const applicationsPath = (): string => "#/applications"
