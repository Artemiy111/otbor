<script setup lang="ts">
import { computed, ref, useId } from "vue"
import type { CrawlSchedule, ScheduleRun } from "@otbor/contract"
import { ChevronDown, LoaderCircle, Pencil, Play, Trash2, TriangleAlert } from "@lucide/vue"
import { cn, formatDate } from "@/shared/lib"
import { Badge, Button, Hint } from "@/shared/ui"
import {
  formatAgo,
  formatInterval,
  hasScheduleError,
  humanScheduleError,
  scheduleCountdown,
  scheduleKindName,
  SCHEDULE_KIND_META,
  type ScheduleTarget
} from "../model"
import ScheduleKindIcon from "./ScheduleKindIcon.vue"
import ScheduleSwitch from "./ScheduleSwitch.vue"

const props = withDefaults(
  defineProps<{
    schedule: CrawlSchedule
    target: ScheduleTarget
    /** Последний законченный запуск, если он известен. */
    lastRun?: ScheduleRun | null
    /** Запуск идёт прямо сейчас. */
    running?: boolean
    /** Итог последнего запуска словами. */
    resultText?: string
    /** Ход идущего запуска словами: «обработано 3 из 25». */
    progressText?: string
    now: number
    expanded?: boolean
    starting?: boolean
    removing?: boolean
    toggling?: boolean
    /** Скрыть раскрытие истории (страница поиска показывает её сама). */
    expandable?: boolean
  }>(),
  {
    lastRun: null,
    running: false,
    resultText: "",
    progressText: "",
    expanded: false,
    starting: false,
    removing: false,
    toggling: false,
    expandable: true
  }
)

const emit = defineEmits<{
  toggle: [enabled: boolean]
  run: []
  edit: []
  remove: []
  expand: [open: boolean]
}>()

const panelId = useId()
const confirming = ref(false)

const isRunning = computed(() => props.running)
const kind = computed(() => props.schedule.kind)
const kindName = computed(() => scheduleKindName(kind.value))
const description = computed(() => SCHEDULE_KIND_META[kind.value]?.description ?? "")
const intervalText = computed(() => formatInterval(props.schedule.intervalMinutes))
const countdown = computed(() => scheduleCountdown(props.schedule.nextRunAt, props.now))
const errorRaw = computed(() => props.schedule.lastError?.trim() ?? "")
const hasError = computed(() => hasScheduleError(props.schedule))

const lastAt = computed(() => props.lastRun?.finishedAt ?? props.lastRun?.startedAt ?? props.schedule.lastRunAt)
const lastAgo = computed(() => formatAgo(lastAt.value, props.now))
const lastStatus = computed<"done" | "error" | null>(() => {
  if (props.lastRun !== null) return props.lastRun.status === "error" ? "error" : "done"
  if (props.schedule.lastRunAt === null) return null
  return hasError.value ? "error" : "done"
})

const confirmRemove = () => {
  confirming.value = false
  emit("remove")
}
</script>

<template>
  <li
    class="@container rounded-lg border bg-card text-card-foreground"
    :class="{ 'opacity-70': !schedule.enabled && !isRunning }"
    :data-testid="`schedule-row-${schedule.id}`"
  >
    <div
      class="grid grid-cols-2 gap-x-4 gap-y-3 p-4 @4xl:grid-cols-[minmax(0,1.5fr)_8rem_minmax(0,1.8fr)_9rem_auto] @4xl:items-start"
    >
      <div class="col-span-2 flex min-w-0 items-start gap-3 @4xl:col-span-1">
        <ScheduleKindIcon :kind="kind" />
        <div class="min-w-0">
          <Hint :text="description">
            <p class="truncate text-sm font-medium">{{ kindName }}</p>
          </Hint>
          <a
            v-if="target.url"
            :href="target.url"
            target="_blank"
            rel="noreferrer"
            class="block truncate text-sm text-primary underline-offset-4 hover:underline"
            :title="target.url"
          >
            {{ target.text }}
          </a>
          <p v-else class="truncate text-sm text-muted-foreground" :title="target.text">{{ target.text }}</p>
        </div>
      </div>

      <div class="text-sm">
        <span class="block text-xs text-muted-foreground @4xl:hidden">Как часто</span>
        <span class="tabular-nums">{{ intervalText }}</span>
      </div>

      <div class="order-1 col-span-2 min-w-0 space-y-1 text-sm @4xl:order-none @4xl:col-span-1">
        <span class="block text-xs text-muted-foreground @4xl:hidden">Последний запуск</span>
        <div v-if="isRunning" class="flex flex-wrap items-center gap-2">
          <Badge variant="info">
            <LoaderCircle class="mr-1 size-3 animate-spin" aria-hidden="true" />
            Выполняется
          </Badge>
          <span v-if="progressText" class="text-xs tabular-nums text-muted-foreground">{{ progressText }}</span>
        </div>
        <template v-else-if="lastStatus !== null">
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="lastStatus === 'error' ? 'danger' : 'success'">
              {{ lastStatus === "error" ? "Ошибка" : "Готово" }}
            </Badge>
            <span class="text-xs tabular-nums text-muted-foreground" :title="formatDate(lastAt)">{{ lastAgo }}</span>
          </div>
          <p v-if="resultText && lastStatus !== 'error'" class="text-xs text-muted-foreground" :title="resultText">
            {{ resultText }}
          </p>
          <slot name="trend" />
        </template>
        <span v-else class="text-muted-foreground">ещё не запускалось</span>
      </div>

      <div class="text-sm">
        <span class="block text-xs text-muted-foreground @4xl:hidden">Следующий запуск</span>
        <span v-if="isRunning" class="text-muted-foreground">идёт сейчас</span>
        <span v-else-if="!schedule.enabled" class="text-muted-foreground">выключено</span>
        <span
          v-else-if="countdown"
          :class="cn('tabular-nums', countdown.overdue ? 'font-medium text-warning' : '')"
          :title="formatDate(schedule.nextRunAt)"
        >
          {{ countdown.text }}
        </span>
        <span v-else class="text-muted-foreground">—</span>
      </div>

      <div class="order-2 col-span-2 flex flex-wrap items-center gap-1.5 @4xl:order-none @4xl:col-span-1 @4xl:justify-end">
        <ScheduleSwitch
          :model-value="schedule.enabled"
          :label="schedule.enabled ? `Выключить: ${kindName}` : `Включить: ${kindName}`"
          :disabled="toggling"
          @update:model-value="emit('toggle', $event)"
        />
        <template v-if="!confirming">
          <Hint text="Запустить сейчас">
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :disabled="starting || isRunning"
              :aria-label="`Запустить сейчас: ${kindName}`"
              @click="emit('run')"
            >
              <LoaderCircle v-if="starting" class="animate-spin" />
              <Play v-else />
            </Button>
          </Hint>
          <Hint text="Изменить">
            <Button variant="ghost" size="icon" class="size-8" :aria-label="`Изменить: ${kindName}`" @click="emit('edit')">
              <Pencil />
            </Button>
          </Hint>
          <Hint text="Удалить">
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :aria-label="`Удалить: ${kindName}`"
              @click="confirming = true"
            >
              <Trash2 />
            </Button>
          </Hint>
          <Hint v-if="expandable" :text="expanded ? 'Скрыть историю' : 'История запусков'">
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :aria-expanded="expanded"
              :aria-controls="panelId"
              :aria-label="`История запусков: ${kindName}`"
              @click="emit('expand', !expanded)"
            >
              <ChevronDown :class="cn('transition-transform', expanded && 'rotate-180')" />
            </Button>
          </Hint>
        </template>
        <div v-else class="flex items-center gap-1.5" role="group" aria-label="Подтверждение удаления">
          <span class="text-xs text-muted-foreground">Удалить?</span>
          <Button size="sm" variant="destructive" :disabled="removing" @click="confirmRemove">Да</Button>
          <Button size="sm" variant="ghost" @click="confirming = false">Отмена</Button>
        </div>
      </div>
    </div>

    <div v-if="hasError" class="flex items-start gap-2 border-t border-border px-4 py-2 text-xs">
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden="true" />
      <Hint :text="errorRaw">
        <p class="min-w-0 text-danger">
          Последняя ошибка: {{ humanScheduleError(errorRaw) }}
        </p>
      </Hint>
    </div>

    <div v-if="$slots.live && isRunning" class="border-t border-border px-4 py-3">
      <slot name="live" />
    </div>

    <div v-if="expanded && expandable" :id="panelId" class="border-t border-border bg-muted/30 px-4 py-3">
      <slot name="expanded" />
    </div>
  </li>
</template>
