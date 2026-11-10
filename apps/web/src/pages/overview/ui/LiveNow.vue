<script setup lang="ts">
import { computed } from "vue"
import type { CrawlRun, CrawlSchedule, Overview, ScheduleRun } from "@otbor/contract"
import { cn } from "@/shared/lib"
import { scheduleKindLabel } from "@/shared/lib/status"
import { Skeleton } from "@/shared/ui"
import { liveCrawls, queueSentence, runningPhrases, upcomingRuns } from "../model/activity"
import OverviewSection from "./OverviewSection.vue"

const props = defineProps<{
  jobs: Overview["jobs"] | undefined
  crawls: ReadonlyArray<CrawlRun> | undefined
  scheduleRuns: ReadonlyArray<ScheduleRun> | undefined
  schedules: ReadonlyArray<CrawlSchedule> | undefined
  loading: boolean
  now: number
}>()

const crawls = computed(() => liveCrawls(props.crawls ?? []))
/** Остальные запуски по расписанию (догрузка, почта…): поиск уже показан выше с прогрессом. */
const otherRuns = computed(() =>
  (props.scheduleRuns ?? [])
    .filter((run) => run.status === "running" && run.kind !== "search" && run.kind !== "source")
    .map((run) => scheduleKindLabel(run.kind))
)
const phrases = computed(() => (props.jobs === undefined ? [] : runningPhrases(props.jobs.running)))
const busy = computed(() => crawls.value.length > 0 || phrases.value.length > 0 || otherRuns.value.length > 0)
const queue = computed(() => (props.jobs === undefined ? null : queueSentence(props.jobs)))
const longWait = computed(() => (props.jobs?.oldestPendingAgeSeconds ?? 0) > 2 * 3600)
const next = computed(() => upcomingRuns(props.schedules ?? [], props.scheduleRuns ?? [], props.now, 4))
</script>

<template>
  <OverviewSection title="Сейчас" description="Что система делает в эту минуту.">
    <template #aside>
      <span v-if="busy && !props.loading" class="inline-flex items-center gap-1.5 text-xs font-medium text-success">
        <span class="relative flex size-2" aria-hidden="true">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span class="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        работает
      </span>
    </template>

    <div v-if="props.loading" class="space-y-3" aria-busy="true">
      <Skeleton class="h-4 w-2/3" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-3/5" />
    </div>

    <div v-else class="space-y-5">
      <div>
        <ul v-if="busy" class="space-y-2.5">
          <li v-for="crawl in crawls" :key="crawl.id" class="space-y-1.5">
            <p class="text-sm font-medium">{{ crawl.title }}</p>
            <div
              v-if="crawl.progress !== null"
              class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              :aria-valuenow="crawl.progress"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="crawl.title"
            >
              <div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" :style="{ width: `${crawl.progress}%` }" />
            </div>
            <p class="text-xs text-muted-foreground tabular-nums">{{ crawl.detail }}</p>
          </li>
          <li v-for="phrase in phrases" :key="phrase" class="flex items-center gap-2 text-sm">
            <span class="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <span class="first-letter:uppercase tabular-nums">{{ phrase }}</span>
          </li>
          <li v-for="run in otherRuns" :key="run" class="flex items-center gap-2 text-sm">
            <span class="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <span>{{ run }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">Ничего не выполняется.</p>

        <p v-if="queue" :class="cn('mt-3 text-xs tabular-nums', longWait ? 'text-warning' : 'text-muted-foreground')">
          {{ queue }}
        </p>
      </div>

      <div class="border-t pt-4">
        <h3 class="mb-2 text-xs font-medium text-muted-foreground">Дальше по расписанию</h3>
        <ul v-if="next.length > 0" class="space-y-1.5">
          <li v-for="run in next" :key="run.id" class="flex items-baseline justify-between gap-3 text-sm">
            <span class="min-w-0 truncate">{{ run.title }}</span>
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ run.when }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          Запусков нет.
          <a href="/schedules" class="font-medium text-primary underline-offset-4 hover:underline">Расписания</a>
        </p>
      </div>
    </div>
  </OverviewSection>
</template>
