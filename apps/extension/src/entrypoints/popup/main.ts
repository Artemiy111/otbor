import { browser } from "wxt/browser"
import type { Reply, Request } from "@/messages.ts"
import { DEFAULT_SETTINGS } from "@/messages.ts"
import { loadSettings, saveSettings } from "@/settings.ts"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const ping = async () => {
  const status = $("status")
  status.textContent = "проверяю…"
  try {
    const reply = (await browser.runtime.sendMessage({ type: "ping" } satisfies Request)) as Reply<unknown>
    status.textContent = reply.ok ? "сервер доступен" : `недоступен: ${reply.error}`
    status.className = reply.ok ? "ok" : "bad"
  } catch (error) {
    status.textContent = String(error)
    status.className = "bad"
  }
}

const init = async () => {
  const settings = await loadSettings()
  $<HTMLInputElement>("apiUrl").value = settings.apiUrl
  $<HTMLInputElement>("webUrl").value = settings.webUrl
  $<HTMLInputElement>("autoCapture").checked = settings.autoCapture
  $<HTMLInputElement>("autoOpenResponse").checked = settings.autoOpenResponse
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault()
    await saveSettings({
      apiUrl: $<HTMLInputElement>("apiUrl").value.trim() || DEFAULT_SETTINGS.apiUrl,
      webUrl: $<HTMLInputElement>("webUrl").value.trim().replace(/\/$/, "") || DEFAULT_SETTINGS.webUrl,
      autoCapture: $<HTMLInputElement>("autoCapture").checked,
      autoOpenResponse: $<HTMLInputElement>("autoOpenResponse").checked
    })
    await ping()
  })
  await ping()
}

void init()
