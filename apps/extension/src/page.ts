import type { VacancyDraft } from "@otbor/contract"
import { draftFromCard } from "@otbor/crawler/drafts"
import { parseSearchHtml } from "@otbor/crawler/search"
import { extractVacancy } from "@otbor/hh"
import { Effect } from "effect"

/**
 * hh renders its state into `<template id="HH-Lux-InitialState">`. The browser
 * has already decoded the entities, so `content.textContent` is the JSON; it is
 * wrapped back into the markup the shared parsers (`@otbor/hh`, the crawler)
 * were written for. The same code reads a page in the CLI and in the browser.
 */
const STATE_ID = "HH-Lux-InitialState"

const wrap = (json: string): string => `<template id="${STATE_ID}">${json}</template>`

const liveState = (): string | null => {
  const template = document.getElementById(STATE_ID)
  const text = template instanceof HTMLTemplateElement ? template.content.textContent : template?.textContent
  return text === null || text === undefined || text.trim() === "" ? null : wrap(text)
}

/** The server-rendered HTML of a URL, for pages hh navigated to without a reload. */
const fetchedState = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: "same-origin" })
  if (!response.ok) throw new Error(`hh.ru ${response.status}`)
  return response.text()
}

export type PageKind = "vacancy" | "search" | "other"

export const pageKind = (url: URL = new URL(location.href)): PageKind => {
  if (/^\/vacancy\/\d+/.test(url.pathname)) return "vacancy"
  if (url.pathname.startsWith("/search/vacancy")) return "search"
  return "other"
}

export const externalIdOf = (url: URL = new URL(location.href)): string | null =>
  /^\/vacancy\/(\d+)/.exec(url.pathname)?.[1] ?? null

/** `fresh` forces a re-read of the server HTML (hh changed the URL without a reload). */
const stateHtml = async (fresh: boolean): Promise<string> => {
  if (!fresh) {
    const live = liveState()
    if (live !== null) return live
  }
  return fetchedState(location.href)
}

export const readVacancy = async (fresh: boolean): Promise<VacancyDraft> => {
  const html = await stateHtml(fresh)
  return Effect.runPromise(
    extractVacancy(html, { url: location.href, fetchedAt: new Date().toISOString() }).pipe(
      Effect.mapError((error) => new Error(error.message))
    )
  )
}

export const readSearch = async (fresh: boolean): Promise<ReadonlyArray<VacancyDraft>> => {
  const html = await stateHtml(fresh)
  return parseSearchHtml(html).cards.map(draftFromCard)
}
