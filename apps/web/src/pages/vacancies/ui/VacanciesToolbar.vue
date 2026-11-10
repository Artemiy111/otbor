<script setup lang="ts">
import { ref, watch } from "vue"
import { useDebounceFn } from "@vueuse/core"
import { ListFilter, Search, X } from "@lucide/vue"
import type { VacancyListCounts } from "@/entities/vacancy"
import {
  QUICK_VIEWS,
  SORT_OPTIONS,
  type ActiveChip,
  type QuickView
} from "../model/filters"
import { cn, formatNumber } from "@/shared/lib"
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

/**
 * Одна панель управления списком: поиск, быстрые фильтры со счётчиками,
 * сортировка, число найденного и кнопка «Фильтры». Под ней снимаемые чипы
 * всего, что отличается от умолчаний.
 */
const props = defineProps<{
  q: string
  view: QuickView
  sort: string
  total: number
  /** Счётчики быстрых фильтров; без них (старый сервер) числа не показываются. */
  counts: VacancyListCounts | undefined
  panelOpen: boolean
  /** Сколько фильтров из панели включено. */
  panelCount: number
  chips: ReadonlyArray<ActiveChip>
  loading: boolean
}>()

const emit = defineEmits<{
  search: [value: string]
  view: [value: QuickView]
  sort: [value: string]
  "toggle-panel": []
  "remove-chip": [key: ActiveChip["key"]]
  "clear-all": []
}>()

/** Текст в поле живёт отдельно от адреса: адрес обновляется с задержкой, а не на каждую букву. */
const text = ref(props.q)
watch(
  () => props.q,
  (value) => {
    if (text.value.trim() !== value) text.value = value
  }
)
const commit = useDebounceFn((value: string) => emit("search", value.trim()), 300)
const onInput = (value: string | number | undefined) => {
  text.value = String(value ?? "")
  void commit(text.value)
}
const clearText = () => {
  text.value = ""
  emit("search", "")
}

const countOf = (view: QuickView): number | null => {
  const counts = props.counts
  if (counts === undefined) return null
  switch (view) {
    case "all":
      return counts.all
    case "new":
      return counts.fresh ?? null
    case "apply":
      return counts.apply
    case "open":
      return counts.notApplied
    case "applied":
      return counts.applied
  }
}
</script>

<template>
  <div class="mb-4 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-0 flex-1 basis-64 sm:max-w-md">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          class="h-9 pl-8 pr-8"
          placeholder="Название, компания или город"
          aria-label="Поиск по вакансиям"
          :model-value="text"
          @update:model-value="onInput"
          @keydown.enter="emit('search', text.trim())"
        />
        <button
          v-if="text !== ''"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Очистить поиск"
          @click="clearText"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <Select :model-value="sort" @update:model-value="emit('sort', String($event))">
        <SelectTrigger class="h-9 w-[190px]" aria-label="Сортировка"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" :aria-expanded="panelOpen" @click="emit('toggle-panel')">
        <ListFilter class="size-4" />
        Фильтры
        <Badge v-if="panelCount > 0" variant="neutral">{{ panelCount }}</Badge>
      </Button>

      <p class="ml-auto text-sm tabular-nums text-muted-foreground" aria-live="polite">
        <template v-if="loading && total === 0">Загрузка…</template>
        <template v-else>Найдено <b class="font-semibold text-foreground">{{ formatNumber(total) }}</b></template>
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Быстрые фильтры">
      <button
        v-for="item in QUICK_VIEWS"
        :key="item.value"
        type="button"
        :aria-pressed="view === item.value"
        :class="
          cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            view === item.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background hover:bg-accent'
          )
        "
        @click="emit('view', item.value)"
      >
        {{ item.label }}
        <span
          v-if="countOf(item.value) !== null"
          :class="cn('text-xs tabular-nums', view === item.value ? 'text-primary-foreground/80' : 'text-muted-foreground')"
        >{{ formatNumber(countOf(item.value)!) }}</span>
      </button>
    </div>

    <div v-if="chips.length > 0" class="flex flex-wrap items-center gap-1.5" aria-label="Включённые фильтры">
      <span
        v-for="chip in chips"
        :key="chip.key"
        class="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2.5 pr-1 text-xs"
      >
        {{ chip.label }}
        <button
          type="button"
          class="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`Убрать: ${chip.label}`"
          @click="emit('remove-chip', chip.key)"
        >
          <X class="size-3" />
        </button>
      </span>
      <button type="button" class="px-1.5 text-xs text-muted-foreground hover:text-foreground" @click="emit('clear-all')">
        Сбросить всё
      </button>
    </div>
  </div>
</template>
