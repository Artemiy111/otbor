<script setup lang="ts" generic="TData extends RowData">
import { computed } from "vue"
import type { RowData, Table } from "@tanstack/vue-table"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "@lucide/vue"
import { Button } from "../button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../select"

const props = withDefaults(
  defineProps<{
    table: Table<TData>
    pageSizeOptions?: ReadonlyArray<number>
  }>(),
  { pageSizeOptions: () => [10, 20, 25, 50, 100] }
)

const pageSize = computed({
  get: () => String(props.table.getState().pagination.pageSize),
  set: (value: string) => props.table.setPageSize(Number(value))
})

const pageCount = computed(() => Math.max(1, props.table.getPageCount()))
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      Страница {{ props.table.getState().pagination.pageIndex + 1 }} из {{ pageCount }}
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">Строк на странице</span>
        <Select v-model="pageSize">
          <SelectTrigger class="h-8 w-[76px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in props.pageSizeOptions" :key="option" :value="String(option)">
              {{ option }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8"
          aria-label="Первая страница"
          :disabled="!props.table.getCanPreviousPage()"
          @click="props.table.firstPage()"
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8"
          aria-label="Предыдущая страница"
          :disabled="!props.table.getCanPreviousPage()"
          @click="props.table.previousPage()"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8"
          aria-label="Следующая страница"
          :disabled="!props.table.getCanNextPage()"
          @click="props.table.nextPage()"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8"
          aria-label="Последняя страница"
          :disabled="!props.table.getCanNextPage()"
          @click="props.table.lastPage()"
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  </div>
</template>
