import { defineContentScript } from "wxt/utils/define-content-script"
import { browser } from "wxt/browser"
import type { VacancyDraft, VacancyLookupItem } from "@otbor/contract"
import type { CaptureReply, Reply, Request, Settings } from "@/messages.ts"
import {
  hasUnpaintedCards,
  onVacancySync,
  paintCards,
  renderVacancy,
  vacancyRowsMissing,
  type PanelState
} from "@/overlay.ts"
import { externalIdOf, pageKind, readSearch, readVacancy } from "@/page.ts"
import { loadSettings } from "@/settings.ts"
import { startResponseWatch } from "@/respond.ts"
import { installPerf, lazyImages } from "@/perf.ts"

export default defineContentScript({
  matches: ["*://*.hh.ru/*"],
  runAt: "document_idle",
  main() {
    const send = async <T>(request: Request): Promise<T> => {
      const reply = (await browser.runtime.sendMessage(request)) as Reply<T> | undefined
      if (reply === undefined) throw new Error("Нет ответа от расширения")
      if (!reply.ok) throw new Error(reply.error)
      return reply.value
    }

    const isOffline = (message: string): boolean => /fetch|network|ECONNREFUSED|Failed to|RpcClientError|Transport/i.test(message)

    let running = false
    let cards: ReadonlyMap<string, VacancyLookupItem> = new Map()
    let panel: { readonly state: PanelState; readonly settings: Settings } | null = null

    const show = (state: PanelState, settings: Settings): void => {
      panel = { state, settings }
      renderVacancy(state, settings)
    }

    let lastUrl = ""
    let responses: ReturnType<typeof startResponseWatch> | null = null

    /** `force`: the operator pressed the sync button, so save the page even when auto-capture is off. */
    const run = async (fresh: boolean, force = false): Promise<void> => {
      if (running) return
      running = true
      lastUrl = location.href
      const settings: Settings = await loadSettings()
      const kind = pageKind()
      try {
        if (kind === "vacancy") {
          show({ status: "loading" }, settings)
          const externalId = externalIdOf()
          if (externalId === null) return
          let reply: CaptureReply | null = null
          let saved: "inserted" | "updated" | "skipped" = "skipped"
          if (settings.autoCapture || force) {
            const draft: VacancyDraft = await readVacancy(fresh)
            reply = await send<CaptureReply>({ type: "capture", drafts: [draft], evaluate: true })
            saved = reply.inserted > 0 ? "inserted" : reply.updated > 0 ? "updated" : "skipped"
          }
          const items = reply?.items ?? (await send<CaptureReply["items"]>({ type: "lookup", externalIds: [externalId] }))
          const item = items.find((i) => i.externalId === externalId)
          show({ status: "ok", item, saved }, settings)
          await responses?.maybeOpen(settings).catch((error) => console.warn("[otbor] open response", error))
        } else if (kind === "search") {
          const drafts = await readSearch(fresh)
          if (drafts.length === 0) return
          const ids = drafts.map((d) => d.externalId)
          const items = settings.autoCapture
            ? (await send<CaptureReply>({ type: "capture", drafts, evaluate: false })).items
            : await send<CaptureReply["items"]>({ type: "lookup", externalIds: ids })
          cards = new Map(items.map((i) => [i.externalId, i]))
          paintCards(cards, settings.webUrl)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (kind === "vacancy") {
          show(
            isOffline(message)
              ? { status: "offline", message: "Запустите `otbor up` или проверьте адрес в настройках расширения." }
              : { status: "error", message },
            settings
          )
        } else {
          console.warn("[otbor]", message)
        }
      } finally {
        running = false
      }
    }

    // hh is a React app: it re-renders cards and the header block after we paint.
    // Repaint from the cached data (no requests) whenever our markup is gone.
    let repaint: ReturnType<typeof setTimeout> | undefined
    const watch = () => {
      new MutationObserver(() => {
        clearTimeout(repaint)
        repaint = setTimeout(() => {
          responses?.check()
          if (pageKind() === "search") lazyImages()
          if (running) return
          if (pageKind() === "search" && cards.size > 0 && hasUnpaintedCards()) {
            void loadSettings().then((settings) => paintCards(cards, settings.webUrl))
          }
          if (pageKind() === "vacancy" && panel !== null && vacancyRowsMissing()) {
            renderVacancy(panel.state, panel.settings)
          }
        }, 300)
      }).observe(document.body, { childList: true, subtree: true })
    }

    onVacancySync(() => void run(true, true))

    const start = () => {
      installPerf()
      responses = startResponseWatch(send)
      responses.check()
      watch()
      void run(false)
      // hh moves between result pages and vacancies without a full reload.
      setInterval(() => {
        // The response form appears without a navigation (a popup, a toggle).
        responses?.check()
        if (location.href !== lastUrl && !running) void run(true)
      }, 1000)
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true })
    else start()
  }
})
