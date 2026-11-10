<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core"
import { healthApi, healthKeys } from "@/entities/health"
import { cn, toneClasses, type StatusTone } from "@/shared/lib"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip"

const query = useQuery({
  key: () => healthKeys.current(),
  query: () => healthApi.get()
})

/** Опрос раз в 15 секунд, пока вкладка видна. */
const POLL_MS = 15_000
const visibility = useDocumentVisibility()
useIntervalFn(() => {
  if (visibility.value !== "hidden") void query.refetch()
}, POLL_MS)

interface Row {
  readonly label: string
  readonly value: string
  readonly tone: StatusTone
}

const summary = computed<{ tone: StatusTone; label: string; rows: ReadonlyArray<Row> }>(() => {
  const data = query.data.value
  if (query.error.value != null || (data === undefined && !query.isPending.value)) {
    return {
      tone: "danger",
      label: "Сервер недоступен",
      rows: [{ label: "API", value: "не отвечает", tone: "danger" }]
    }
  }
  if (data === undefined) {
    return { tone: "neutral", label: "Проверка…", rows: [] }
  }

  const browserOnline = (data.harnesses ?? []).some(
    (harness) => harness.online && harness.kinds.includes("browser")
  )
  const rows: ReadonlyArray<Row> = [
    {
      label: "API",
      value: data.status === "ok" ? "работает" : "сбои",
      tone: data.status === "ok" ? "success" : "danger"
    },
    {
      label: "База данных",
      value: data.database ? "работает" : "недоступна",
      tone: data.database ? "success" : "danger"
    },
    {
      label: "Исполнитель браузера",
      value: browserOnline ? "онлайн" : "не запущен",
      tone: browserOnline ? "success" : "warning"
    },
    {
      label: "Модель анализа",
      value:
        data.systemOne === undefined
          ? "не настроена"
          : data.systemOne.reachable
            ? "отвечает"
            : "недоступна",
      tone:
        data.systemOne === undefined ? "neutral" : data.systemOne.reachable ? "success" : "warning"
    }
  ]

  if (data.status !== "ok" || !data.database) {
    return { tone: "danger", label: "Сервер недоступен", rows }
  }
  if (!browserOnline) return { tone: "warning", label: "Нет исполнителя", rows }
  return { tone: "success", label: "Работает", rows }
})

const classes = computed(() => toneClasses(summary.value.tone))
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <a
        href="/health"
        :class="
          cn(
            'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            classes.border,
            classes.text
          )
        "
        aria-label="Состояние системы"
      >
        <span class="relative flex size-2">
          <span
            v-if="summary.tone === 'success'"
            :class="cn('absolute inline-flex size-full animate-ping rounded-full opacity-40', classes.dot)"
          />
          <span :class="cn('relative inline-flex size-2 rounded-full', classes.dot)" />
        </span>
        <span class="hidden sm:inline">{{ summary.label }}</span>
      </a>
    </TooltipTrigger>
    <TooltipContent align="end" class="min-w-52 space-y-1.5 p-3">
      <p class="text-xs font-semibold">{{ summary.label }}</p>
      <ul v-if="summary.rows.length > 0" class="space-y-1">
        <li v-for="row in summary.rows" :key="row.label" class="flex items-center gap-2 text-xs">
          <span :class="cn('size-1.5 shrink-0 rounded-full', toneClasses(row.tone).dot)" />
          <span class="text-muted-foreground">{{ row.label }}</span>
          <span class="ml-auto pl-3 tabular-nums">{{ row.value }}</span>
        </li>
      </ul>
      <p class="text-xs text-muted-foreground">Подробнее на странице «Состояние»</p>
    </TooltipContent>
  </Tooltip>
</template>
