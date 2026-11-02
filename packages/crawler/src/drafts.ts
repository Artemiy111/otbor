import type { VacancyDraft } from "@otbor/contract"
import { inferSeniority, resolveWorkFormats } from "@otbor/hh"
import type { SearchCard } from "./search.ts"

/**
 * A search card is a valid `VacancyDraft` with a short description. The full
 * page replaces it later, but the stub is enough to make the vacancy visible,
 * run the title gate and enqueue hydration.
 */
export const draftFromCard = (card: SearchCard): VacancyDraft => {
  const text = card.snippet ?? ""
  const salary =
    card.salaryFrom === null &&
    card.salaryTo === null &&
    !card.salaryNegotiable
      ? null
      : {
          from: card.salaryFrom,
          to: card.salaryTo,
          currency: card.salaryCurrency,
          gross: card.salaryGross,
          negotiable: card.salaryNegotiable
        }

  return {
    source: "hh",
    externalId: card.externalId,
    canonicalUrl: `https://hh.ru/vacancy/${card.externalId}`,
    url: card.url,
    title: card.title,
    employer:
      card.companyExternalId === null || card.companyName === null
        ? null
        : {
            externalId: card.companyExternalId,
            name: card.companyName
          },
    areaId: card.areaId,
    areaName: card.areaName,
    salary,
    experienceCode: card.experienceCode,
    employmentForm: card.employmentForm,
    workFormats: resolveWorkFormats(card.workFormats, text),
    seniority: inferSeniority(card.title, text),
    publishedAt: card.publishedAt,
    archived: card.archived,
    descriptionHtml: null,
    descriptionText: card.snippet,
    skills: [],
    raw: card
  }
}
