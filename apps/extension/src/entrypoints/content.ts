import { defineContentScript } from "wxt/utils/define-content-script"
import { browser } from "wxt/browser"
import type { VacancyDraft } from "@otbor/contract"
import type { CaptureReply, Reply, Request, Settings } from "@/messages.ts"
import { paintBadges, renderPanel } from "@/overlay.ts"
import { externalIdOf, pageKind, readSearch, readVacancy } from "@/page.ts"
import { loadSettings } from "@/settings.ts"

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
    let lastUrl = ""

    const run = async (fresh: boolean): Promise<void> => {
      if (running) return
      running = true
      lastUrl = location.href
      const settings: Settings = await loadSettings()
      const kind = pageKind()
      try {
        if (kind === "vacancy") {
          renderPanel({ status: "loading" }, settings)
          const externalId = externalIdOf()
          if (externalId === null) return
          let reply: CaptureReply | null = null
          let saved: "inserted" | "updated" | "skipped" = "skipped"
          if (settings.autoCapture) {
            const draft: VacancyDraft = await readVacancy(fresh)
            reply = await send<CaptureReply>({ type: "capture", drafts: [draft], evaluate: true })
            saved = reply.inserted > 0 ? "inserted" : reply.updated > 0 ? "updated" : "skipped"
          }
          const items = reply?.items ?? (await send<CaptureReply["items"]>({ type: "lookup", externalIds: [externalId] }))
          const item = items.find((i) => i.externalId === externalId)
          renderPanel({ status: "ok", item, saved }, settings)
        } else if (kind === "search") {
          const drafts = await readSearch(fresh)
          if (drafts.length === 0) return
          const ids = drafts.map((d) => d.externalId)
          const items = settings.autoCapture
            ? (await send<CaptureReply>({ type: "capture", drafts, evaluate: false })).items
            : await send<CaptureReply["items"]>({ type: "lookup", externalIds: ids })
          paintBadges(new Map(items.map((i) => [i.externalId, i])))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (kind === "vacancy") {
          renderPanel(
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

    const start = () => {
      void run(false)
      // hh moves between result pages and vacancies without a full reload.
      setInterval(() => {
        if (location.href !== lastUrl && !running) void run(true)
      }, 1000)
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true })
    else start()
  }
})
