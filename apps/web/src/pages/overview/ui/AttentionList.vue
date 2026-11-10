<script setup lang="ts">
import { computed, ref } from "vue"
import {
  ArrowRight,
  CircleCheck,
  Database,
  FileText,
  Gauge,
  Globe,
  Hourglass,
  Inbox,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Monitor,
  RotateCw,
  Server,
  ShieldAlert,
  Sparkles,
  CalendarX
} from "@lucide/vue"
import { cn, toneClasses } from "@/shared/lib"
import { Button, Skeleton } from "@/shared/ui"
import type { AttentionIcon, AttentionItem, AttentionTone } from "../model/attention"
import { agoText } from "../model/time"
import OverviewSection from "./OverviewSection.vue"

const props = defineProps<{
  items: ReadonlyArray<AttentionItem>
  loading: boolean
  now: number
  /** Когда данные собраны на сервере (ISO): для строки «проверено». */
  checkedAt: string | null
  /** Аккаунты, для которых сейчас идёт «Повторить сейчас». */
  retrying: ReadonlySet<string>
}>()

const emit = defineEmits<{ retry: [accountId: string] }>()

const ICONS: Record<AttentionIcon, typeof Server> = {
  server: Server,
  database: Database,
  browser: Monitor,
  session: KeyRound,
  captcha: ShieldAlert,
  application: FileText,
  draft: FileText,
  jobs: ListChecks,
  schedule: CalendarX,
  inbox: Inbox,
  limit: Gauge,
  proxy: Globe,
  model: Sparkles,
  stalled: Hourglass
}

const GROUPS: ReadonlyArray<{ tone: AttentionTone; label: string }> = [
  { tone: "danger", label: "Срочно" },
  { tone: "warning", label: "Требует решения" },
  { tone: "info", label: "К сведению" }
]

const VISIBLE = 9
const expanded = ref(false)

/** Сначала считаем видимые строки, потом раскладываем по группам: порядок уже отсортирован. */
const shown = computed(() => (expanded.value ? props.items : props.items.slice(0, VISIBLE)))
const hidden = computed(() => props.items.length - shown.value.length)
const groups = computed(() =>
  GROUPS.flatMap((group) => {
    const items = shown.value.filter((item) => item.tone === group.tone)
    return items.length > 0 ? [{ ...group, items }] : []
  })
)
const counts = computed(() =>
  GROUPS.flatMap((group) => {
    const count = props.items.filter((item) => item.tone === group.tone).length
    return count > 0 ? [{ ...group, count }] : []
  })
)
const checked = computed(() => agoText(props.checkedAt, props.now))
</script>

<template>
  <OverviewSection title="Требует вас" description="Что остановилось или ждёт вашего решения, по важности." body-class="flex flex-col">
    <template #aside>
      <span
        v-for="group in props.loading ? [] : counts"
        :key="group.tone"
        :class="cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums', toneClasses(group.tone).badge)"
      >
        <span :class="cn('size-1.5 rounded-full', toneClasses(group.tone).dot)" aria-hidden="true" />
        {{ group.count }}
        <span class="sr-only">{{ group.label }}</span>
      </span>
    </template>

    <div v-if="props.loading" class="space-y-3" aria-busy="true">
      <div v-for="index in 4" :key="index" class="flex items-center gap-3">
        <Skeleton class="size-9 rounded-full" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-3 w-1/3" />
        </div>
        <Skeleton class="h-8 w-20" />
      </div>
    </div>

    <div
      v-else-if="props.items.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-success/30 bg-success-muted px-6 py-10 text-center"
    >
      <span class="flex size-12 items-center justify-center rounded-full bg-background/70 text-success">
        <CircleCheck class="size-7" aria-hidden="true" />
      </span>
      <div class="space-y-1">
        <p class="text-base font-semibold">Ничего не требует вашего участия</p>
        <p class="text-sm text-muted-foreground">
          <template v-if="checked">Последняя проверка — {{ checked }}.</template>
          <template v-else>Мы продолжаем следить за системой.</template>
        </p>
      </div>
    </div>

    <div v-else class="space-y-5">
      <div v-for="group in groups" :key="group.tone">
        <h3 class="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span :class="cn('size-1.5 rounded-full', toneClasses(group.tone).dot)" aria-hidden="true" />
          {{ group.label }}
        </h3>
        <ul class="divide-y">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <span
              :class="cn('flex size-9 shrink-0 items-center justify-center rounded-full border', toneClasses(item.tone).badge)"
              aria-hidden="true"
            >
              <component :is="ICONS[item.icon]" class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium leading-5 text-pretty">{{ item.title }}</p>
              <p v-if="item.detail" class="mt-0.5 text-xs text-muted-foreground text-pretty">{{ item.detail }}</p>
            </div>
            <div class="col-start-2 sm:col-start-auto">
              <Button
                v-if="item.action.kind === 'retry-captcha'"
                variant="outline"
                size="sm"
                :disabled="props.retrying.has(item.action.accountId)"
                @click="item.action.kind === 'retry-captcha' && emit('retry', item.action.accountId)"
              >
                <LoaderCircle v-if="item.action.kind === 'retry-captcha' && props.retrying.has(item.action.accountId)" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <RotateCw v-else aria-hidden="true" />
                {{ item.action.label }}
              </Button>
              <Button v-else variant="ghost" size="sm" as="a" :href="item.action.href" class="-mx-1 sm:mx-0">
                {{ item.action.label }}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="hidden > 0 || expanded" class="flex justify-center border-t pt-3">
        <Button variant="ghost" size="sm" :aria-expanded="expanded" @click="expanded = !expanded">
          {{ expanded ? "Свернуть" : `Показать ещё ${hidden}` }}
        </Button>
      </div>
    </div>
  </OverviewSection>
</template>
