<script setup lang="ts">
import { ref } from "vue"
import type { CrawlRun, CrawlSchedule, ScheduleRun } from "@otbor/contract"
import { CrawlProgress, runningCrawlFor } from "@/entities/crawl-run"
import {
  scheduleTarget,
  ScheduleRow,
  type ScheduleSection,
  type TargetLookup
} from "@/entities/schedule"
import { insertedTrend, runProgressText, runResultText, type RunIndex } from "@/entities/schedule-run"
import { countWord } from "@/shared/lib"
import type { useScheduleActions } from "../model/use-schedule-actions"
import ScheduleRunsPanel from "./ScheduleRunsPanel.vue"
import ScheduleTrend from "./ScheduleTrend.vue"

/**
 * Список расписаний по группам. Одна и та же строка и те же слова на странице
 * расписаний и на странице поиска: страница только выбирает, какие группы показать.
 */
withDefaults(
  defineProps<{
    sections: ReadonlyArray<ScheduleSection>
    lookup: TargetLookup
    runIndex: RunIndex
    runs: ReadonlyArray<ScheduleRun>
    crawlRuns: ReadonlyArray<CrawlRun>
    now: number
    actions: ReturnType<typeof useScheduleActions>
    showTitles?: boolean
    /** Показывать полосу хода поиска внутри строки (страница поиска рисует её крупно сама). */
    liveInRows?: boolean
  }>(),
  { showTitles: true, liveInRows: true }
)

defineEmits<{ edit: [schedule: CrawlSchedule] }>()

const expanded = ref(new Set<string>())
const setExpanded = (id: string, open: boolean) => {
  const next = new Set(expanded.value)
  if (open) next.add(id)
  else next.delete(id)
  expanded.value = next
}

const isSearch = (schedule: CrawlSchedule): boolean => schedule.kind === "search" || schedule.kind === "source"
const SCHEDULE_FORMS: [string, string, string] = ["расписание", "расписания", "расписаний"]
</script>

<template>
  <div class="space-y-6">
    <section v-for="section in sections" :key="section.group.key" :aria-labelledby="`group-${section.group.key}`">
      <h2
        v-if="showTitles"
        :id="`group-${section.group.key}`"
        class="mb-2 flex items-baseline gap-2 text-sm font-semibold"
      >
        {{ section.group.label }}
        <span class="text-xs font-normal tabular-nums text-muted-foreground">
          {{ countWord(section.items.length, SCHEDULE_FORMS) }}
        </span>
      </h2>
      <ul class="space-y-2">
        <ScheduleRow
          v-for="schedule in section.items"
          :key="schedule.id"
          :schedule="schedule"
          :target="scheduleTarget(schedule, lookup)"
          :last-run="runIndex.latest.get(schedule.id) ?? null"
          :running="runIndex.running.has(schedule.id) || (isSearch(schedule) && runningCrawlFor(crawlRuns, schedule.targetId) !== undefined)"
          :result-text="
            runIndex.latest.has(schedule.id)
              ? runResultText(schedule.kind, runIndex.latest.get(schedule.id)?.detail)
              : ''
          "
          :progress-text="runProgressText(runIndex.running.get(schedule.id)?.detail)"
          :now="now"
          :expanded="expanded.has(schedule.id)"
          :starting="actions.starting.value.has(schedule.id)"
          :removing="actions.removing.value.has(schedule.id)"
          :toggling="actions.toggling.value.has(schedule.id)"
          @toggle="(enabled) => actions.toggle(schedule, enabled)"
          @run="actions.run(schedule)"
          @edit="$emit('edit', schedule)"
          @remove="actions.remove(schedule)"
          @expand="(open) => setExpanded(schedule.id, open)"
        >
          <template v-if="isSearch(schedule)" #trend>
            <ScheduleTrend :values="insertedTrend(runs, schedule.id)" class="mt-1" />
          </template>
          <template v-if="liveInRows && isSearch(schedule) && runningCrawlFor(crawlRuns, schedule.targetId)" #live>
            <CrawlProgress :run="runningCrawlFor(crawlRuns, schedule.targetId)!" :now="now" compact />
          </template>
          <template #expanded>
            <ScheduleRunsPanel :schedule-id="schedule.id" />
          </template>
        </ScheduleRow>
      </ul>
    </section>
  </div>
</template>
