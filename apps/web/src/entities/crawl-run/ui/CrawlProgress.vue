<script setup lang="ts">
import { computed } from "vue"
import type { CrawlRun } from "@otbor/contract"
import { formatDate, toneClasses } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui"
import { CircleAlert } from "@lucide/vue"
import { elapsedLabel, isStaleCrawl, pagePosition, progressPercent } from "../model"

const props = withDefaults(
  defineProps<{
    run: CrawlRun
    /** Одна строка с полосой, без счётчиков: для строки расписания. */
    compact?: boolean
    now?: number
  }>(),
  { compact: false, now: undefined }
)

const percent = computed(() => progressPercent(props.run))
const position = computed(() => pagePosition(props.run))
const stale = computed(() => isStaleCrawl(props.run, props.now))
const info = toneClasses("info")
</script>

<template>
  <div v-if="compact" class="space-y-1.5" :data-testid="`crawl-progress-${run.runId}`">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
      <span :class="info.text" class="font-medium">Идёт поиск: {{ position }}</span>
      <span class="tabular-nums text-muted-foreground">
        найдено {{ run.found }} · новых {{ run.inserted }} · {{ elapsedLabel(run.startedAt, now) }}
      </span>
    </div>
    <div
      class="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      :aria-label="position"
      :aria-valuenow="percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="h-full rounded-full bg-info transition-all duration-500"
        :class="{ 'w-1/3 animate-pulse': percent === null }"
        :style="percent === null ? undefined : { width: `${percent}%` }"
      />
    </div>
  </div>

  <div v-else class="space-y-3 rounded-lg border p-4" :class="[info.border, info.bg]">
    <div class="min-w-0">
      <slot name="title" />
      <p class="mt-1 text-xs text-muted-foreground">
        Запущен {{ formatDate(run.startedAt) }} · идёт {{ elapsedLabel(run.startedAt, now) }}
      </p>
    </div>

    <Alert v-if="stale" variant="warning">
      <CircleAlert />
      <AlertTitle>Запуск давно не обновляется</AlertTitle>
      <AlertDescription>
        Если worker остановился, поиск может навсегда остаться в статусе «идёт».
      </AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-medium">{{ position }}</p>
        <p class="text-xs text-muted-foreground">обработано страниц: {{ run.pagesDone }}</p>
      </div>
      <p class="text-xs tabular-nums text-muted-foreground">
        {{ percent === null ? "всего страниц неизвестно" : `${percent}%` }}
      </p>
    </div>

    <div
      class="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      :aria-label="position"
      :aria-valuenow="percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="h-full rounded-full bg-info transition-all duration-500"
        :class="{ 'w-1/3 animate-pulse': percent === null }"
        :style="percent === null ? undefined : { width: `${percent}%` }"
      />
    </div>

    <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <p class="text-xs text-muted-foreground">Найдено</p>
        <p class="font-semibold tabular-nums">{{ run.found }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">Новых</p>
        <p class="font-semibold tabular-nums">{{ run.inserted }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">Обновлено</p>
        <p class="font-semibold tabular-nums">{{ run.updated }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">Пропущено</p>
        <p class="font-semibold tabular-nums">{{ run.skipped }}</p>
      </div>
    </div>
  </div>
</template>
