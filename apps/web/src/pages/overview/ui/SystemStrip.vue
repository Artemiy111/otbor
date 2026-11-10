<script setup lang="ts">
import { computed } from "vue"
import type { Health, ProxyStatus } from "@otbor/contract"
import { cn, toneClasses, type StatusTone } from "@/shared/lib"
import { browserOnline } from "../model/attention"

const props = defineProps<{
  health: Health | undefined
  healthFailed: boolean
  proxy: ProxyStatus | undefined
}>()

interface Pill {
  readonly id: string
  readonly label: string
  readonly state: string
  readonly tone: StatusTone
}

const pills = computed<ReadonlyArray<Pill>>(() => {
  const health = props.health
  if (props.healthFailed) {
    return [{ id: "api", label: "API", state: "не отвечает", tone: "danger" }]
  }
  if (health === undefined) return []
  const browser = browserOnline(health)
  const proxy = props.proxy
  const proxyPill: Pill =
    proxy === undefined
      ? { id: "proxy", label: "Прокси", state: "неизвестно", tone: "neutral" }
      : !proxy.configured
        ? { id: "proxy", label: "Прокси", state: "не нужен", tone: "neutral" }
        : proxy.engine !== null && !proxy.engine.reachable
          ? { id: "proxy", label: "Прокси", state: "не отвечает", tone: "warning" }
          : { id: "proxy", label: "Прокси", state: "работает", tone: "success" }
  return [
    { id: "api", label: "API", state: health.status === "ok" ? "работает" : "сбои", tone: health.status === "ok" ? "success" : "danger" },
    { id: "db", label: "База", state: health.database ? "работает" : "недоступна", tone: health.database ? "success" : "danger" },
    {
      id: "browser",
      label: "Исполнитель браузера",
      state: browser === null ? "неизвестно" : browser ? "онлайн" : "не подключён",
      tone: browser === null ? "neutral" : browser ? "success" : "warning"
    },
    {
      id: "model",
      label: "Модель",
      state: health.systemOne === undefined ? "не настроена" : health.systemOne.reachable ? "отвечает" : "не отвечает",
      tone: health.systemOne === undefined ? "neutral" : health.systemOne.reachable ? "success" : "warning"
    },
    proxyPill
  ]
})
</script>

<template>
  <nav aria-label="Состояние служб" class="flex flex-wrap items-center gap-x-1 gap-y-1">
    <span class="mr-1 text-xs text-muted-foreground">Службы</span>
    <a
      v-for="pill in pills"
      :key="pill.id"
      href="/health"
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span :class="cn('size-1.5 rounded-full', toneClasses(pill.tone).dot)" aria-hidden="true" />
      {{ pill.label }}
      <span :class="pill.tone === 'success' || pill.tone === 'neutral' ? '' : cn('font-medium', toneClasses(pill.tone).text)">· {{ pill.state }}</span>
    </a>
  </nav>
</template>
