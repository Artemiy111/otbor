<script setup lang="ts">
import { computed, ref } from "vue"
import {
  CalendarCheck,
  CalendarX,
  CircleAlert,
  CircleX,
  Eye,
  Hand,
  Search,
  SearchX,
  Send,
  ShieldAlert
} from "@lucide/vue"
import type { OverviewEventKind } from "@otbor/contract"
import { defaultHhAccountColor } from "@/entities/hh-account"
import { cn, formatDate, toneClasses, type StatusTone } from "@/shared/lib"
import { Button, Skeleton } from "@/shared/ui"
import {
  EVENT_FILTERS,
  eventHref,
  eventLabel,
  eventSubtitle,
  eventTitle,
  groupEvents,
  matchesFilter,
  type EventFilter,
  type OverviewEvent
} from "../model/events"
import { agoText } from "../model/time"
import OverviewSection from "./OverviewSection.vue"

const props = defineProps<{
  events: ReadonlyArray<OverviewEvent> | undefined
  /** id аккаунта → цвет, чтобы точка события совпадала с карточкой аккаунта. */
  accountColors: ReadonlyMap<string, string>
  loading: boolean
  now: number
}>()

const KIND: Record<OverviewEventKind, { icon: typeof Send; tone: StatusTone }> = {
  sent: { icon: Send, tone: "info" },
  invited: { icon: CalendarCheck, tone: "success" },
  rejected: { icon: CircleX, tone: "neutral" },
  viewed: { icon: Eye, tone: "neutral" },
  needs_human: { icon: Hand, tone: "warning" },
  failed: { icon: CircleAlert, tone: "danger" },
  crawl_done: { icon: Search, tone: "neutral" },
  crawl_error: { icon: SearchX, tone: "warning" },
  schedule_error: { icon: CalendarX, tone: "warning" },
  captcha: { icon: ShieldAlert, tone: "warning" }
}

const filter = ref<EventFilter>("all")
const expanded = ref(false)
const LIMIT = 7

const filtered = computed(() => (props.events ?? []).filter((event) => matchesFilter(event, filter.value)))
const visible = computed(() => (expanded.value ? filtered.value : filtered.value.slice(0, LIMIT)))
const groups = computed(() => groupEvents(visible.value, props.now))
const hiddenCount = computed(() => filtered.value.length - visible.value.length)

const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" })
const whenText = (event: OverviewEvent, isToday: boolean): string =>
  isToday ? (agoText(event.at, props.now) ?? "") : clock.format(new Date(event.at))
</script>

<template>
  <OverviewSection title="Лента событий" description="Что произошло недавно, свежее сверху.">
    <div class="-mt-1 mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Фильтр событий">
      <button
        v-for="option in EVENT_FILTERS"
        :key="option.id"
        type="button"
        :aria-pressed="filter === option.id"
        :class="
          cn(
            'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filter === option.id
              ? 'border-foreground/80 bg-foreground text-background'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )
        "
        @click="((filter = option.id), (expanded = false))"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="props.loading" class="space-y-4" aria-busy="true">
      <div v-for="index in 5" :key="index" class="flex items-start gap-3">
        <Skeleton class="size-7 rounded-full" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-3 w-1/3" />
        </div>
      </div>
    </div>

    <p v-else-if="props.events === undefined" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      Лента событий недоступна.
    </p>

    <p v-else-if="filtered.length === 0" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {{ filter === "all" ? "Событий пока нет." : "В этой категории событий нет." }}
    </p>

    <div v-else class="space-y-5">
      <section v-for="group in groups" :key="group.key" :aria-label="group.label">
        <h3 class="mb-1 text-xs font-medium text-muted-foreground">{{ group.label }}</h3>
        <ol class="relative">
          <li v-for="(event, index) in group.events" :key="`${event.at}-${event.kind}-${index}`" class="flex items-start gap-3 py-2">
            <span
              :class="cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border', toneClasses(KIND[event.kind].tone).badge)"
              aria-hidden="true"
            >
              <component :is="KIND[event.kind].icon" class="size-3.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm leading-5">
                <span class="sr-only">{{ eventLabel(event) }}: </span>
                <a
                  v-if="eventHref(event)"
                  :href="eventHref(event) ?? undefined"
                  class="rounded font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >{{ eventTitle(event) }}</a>
                <span v-else class="font-medium">{{ eventTitle(event) }}</span>
              </p>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span :class="cn('font-medium', toneClasses(KIND[event.kind].tone).text)">{{ eventLabel(event) }}</span>
                <template v-if="eventSubtitle(event)">
                  <span aria-hidden="true">·</span>
                  <span class="min-w-0 truncate">{{ eventSubtitle(event) }}</span>
                </template>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-muted-foreground tabular-nums">
              <span
                v-if="event.hhAccountId"
                class="size-2 rounded-full"
                :style="{ backgroundColor: props.accountColors.get(event.hhAccountId) ?? defaultHhAccountColor(event.hhAccountId) }"
                role="img"
                aria-label="Аккаунт события"
              />
              <time :datetime="event.at" :title="formatDate(event.at)">{{ whenText(event, group.isToday) }}</time>
            </div>
          </li>
        </ol>
      </section>

      <div v-if="hiddenCount > 0 || expanded" class="flex justify-center border-t pt-3">
        <Button variant="ghost" size="sm" :aria-expanded="expanded" @click="expanded = !expanded">
          {{ expanded ? "Свернуть" : `Показать ещё ${hiddenCount}` }}
        </Button>
      </div>
    </div>
  </OverviewSection>
</template>
