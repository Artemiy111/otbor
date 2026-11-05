<script setup lang="ts">
import { computed } from "vue"
import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/vue"
import { cn } from "@/shared/lib"
import { Button } from "../button"
import { HelpHint } from "../help-hint"

/** The slice of a TanStack column this header needs, kept structural for reuse. */
interface SortableColumn {
  getCanSort: () => boolean
  getIsSorted: () => false | "asc" | "desc"
  toggleSorting: (desc?: boolean, isMulti?: boolean) => void
}

const props = withDefaults(
  defineProps<{
    column: SortableColumn
    title: string
    align?: "left" | "right"
    hint?: string
  }>(),
  { align: "left" }
)

const sorted = computed(() => props.column.getIsSorted())
</script>

<template>
  <div class="space-y-1">
  <div :class="cn('flex items-center', props.align === 'right' && 'justify-end')">
    <Button
      v-if="props.column.getCanSort()"
      variant="ghost"
      size="sm"
      :class="
        cn(
          '-ml-2 h-8 px-2 text-xs font-medium normal-case text-muted-foreground',
          props.align === 'right' && 'ml-auto'
        )
      "
      @click="props.column.toggleSorting(sorted === 'asc')"
    >
      <slot>{{ props.title }}</slot>
      <ArrowUp v-if="sorted === 'asc'" />
      <ArrowDown v-else-if="sorted === 'desc'" />
      <ArrowUpDown v-else />
    </Button>
    <span v-else class="text-xs font-medium normal-case text-muted-foreground">
      {{ props.title }}
    </span>
    <HelpHint v-if="props.hint" :text="props.hint" :label="props.title" />
  </div>
  <slot name="filter" />
  </div>
</template>
