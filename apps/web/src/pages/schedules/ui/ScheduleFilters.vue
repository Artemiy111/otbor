<script setup lang="ts">
import { X } from "@lucide/vue"
import {
  EMPTY_FILTER,
  SCHEDULE_GROUPS,
  scheduleKindName,
  type ScheduleFilter,
  type ScheduleGroupKey
} from "@/entities/schedule"
import { cn } from "@/shared/lib"
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const filter = defineModel<ScheduleFilter>("filter", { required: true })

const ALL = "all"

const setGroup = (value: unknown) => {
  const key = String(value)
  // Выбор группы заменяет выбор конкретных видов: два условия сразу путают.
  filter.value = {
    ...filter.value,
    kinds: [],
    group: SCHEDULE_GROUPS.some((group) => group.key === key) ? (key as ScheduleGroupKey) : null
  }
}

const toggle = (key: "errorsOnly" | "disabledOnly") => {
  filter.value = { ...filter.value, [key]: !filter.value[key] }
}

const active = (value: ScheduleFilter): boolean =>
  value.group !== null || value.kinds.length > 0 || value.errorsOnly || value.disabledOnly
</script>

<template>
  <div class="flex flex-wrap items-end gap-x-4 gap-y-3" role="group" aria-label="Фильтры расписаний">
    <div class="w-full space-y-1.5 sm:w-56">
      <Label for="schedule-group-filter" class="text-xs text-muted-foreground">Группа</Label>
      <Select :model-value="filter.group ?? ALL" @update:model-value="setGroup">
        <SelectTrigger id="schedule-group-filter"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL">Все группы</SelectItem>
          <SelectItem v-for="group in SCHEDULE_GROUPS" :key="group.key" :value="group.key">
            {{ group.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Button
      v-for="item in [
        { key: 'errorsOnly', label: 'Только с ошибками' },
        { key: 'disabledOnly', label: 'Выключенные' }
      ] as const"
      :key="item.key"
      type="button"
      size="sm"
      :variant="filter[item.key] ? 'default' : 'outline'"
      :aria-pressed="filter[item.key]"
      :class="cn('h-9')"
      @click="toggle(item.key)"
    >
      {{ item.label }}
    </Button>

    <span
      v-if="filter.kinds.length > 0"
      class="inline-flex h-9 items-center gap-1 rounded-md border bg-muted pl-3 pr-1 text-xs"
    >
      Вид: {{ filter.kinds.map(scheduleKindName).join(", ") }}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-7"
        aria-label="Сбросить фильтр по виду"
        @click="filter = { ...filter, kinds: [] }"
      >
        <X />
      </Button>
    </span>

    <Button v-if="active(filter)" type="button" variant="ghost" size="sm" class="h-9" @click="filter = EMPTY_FILTER">
      Сбросить фильтры
    </Button>
  </div>
</template>
