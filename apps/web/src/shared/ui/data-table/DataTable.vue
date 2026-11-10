<script setup lang="ts" generic="TData extends RowData, TValue = unknown">
import { computed, ref, useId, watchEffect } from "vue"
import {
  FlexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
  type Table
} from "@tanstack/vue-table"
import { Search } from "@lucide/vue"
import { cn } from "@/shared/lib"
import Card from "../card/Card.vue"
import CardContent from "../card/CardContent.vue"
import EmptyState from "../empty-state/EmptyState.vue"
import Input from "../input/Input.vue"
import Label from "../label/Label.vue"
import Skeleton from "../skeleton/Skeleton.vue"
import TableRoot from "../table/Table.vue"
import TableBody from "../table/TableBody.vue"
import TableCell from "../table/TableCell.vue"
import TableHead from "../table/TableHead.vue"
import TableHeader from "../table/TableHeader.vue"
import TableRow from "../table/TableRow.vue"
import DataTablePagination from "./DataTablePagination.vue"
import { valueUpdater } from "./columns"

/** Rows the unpaginated mode keeps visible; effectively every loaded row. */
const UNPAGINATED_SIZE = 100_000

const props = withDefaults(
  defineProps<{
    columns: ColumnDef<TData, TValue>[]
    data: readonly TData[]
    isLoading?: boolean
    loadingRowCount?: number
    emptyTitle?: string
    emptyDescription?: string
    filter?: boolean
    filterLabel?: string
    filterPlaceholder?: string
    /** Enables pagination controls and limits the rendered rows. */
    pageSize?: number
    pageSizeOptions?: ReadonlyArray<number>
    initialSorting?: SortingState
    /** Prefix every row with a visible ordinal. Paginated tables continue across pages. */
    rowNumbers?: boolean
    /**
     * The owner sorts, filters and pages the data (it passes only the current
     * page and `rowCount`). Changes are reported through the `update:*` events.
     */
    serverSide?: boolean
    /** Total matching rows across all pages; used only in `serverSide` mode. */
    rowCount?: number
    /** Уже ширины `sm` строки превращаются в карточки: шапка скрыта, ячейки идут потоком. */
    cards?: boolean
  }>(),
  {
    isLoading: false,
    loadingRowCount: 8,
    emptyTitle: "Нет данных",
    emptyDescription: undefined,
    filter: false,
    filterLabel: "Поиск",
    filterPlaceholder: "Поиск…",
    pageSize: undefined,
    pageSizeOptions: () => [10, 20, 25, 50, 100],
    initialSorting: () => [],
    rowNumbers: true,
    serverSide: false,
    rowCount: undefined,
    cards: false
  }
)

const emit = defineEmits<{
  "update:visibleRows": [rows: TData[]]
  "update:sorting": [sorting: SortingState]
  "update:globalFilter": [value: string]
  "update:pagination": [pagination: PaginationState]
}>()

const slots = defineSlots<{
  toolbar?: (props: { table: Table<TData> }) => unknown
  summary?: (props: { table: Table<TData> }) => unknown
  empty?: () => unknown
}>()

const filterId = useId()
const sorting = ref<SortingState>([...props.initialSorting])
const globalFilter = ref("")
const pagination = ref<PaginationState>({
  pageIndex: 0,
  pageSize: props.pageSize ?? UNPAGINATED_SIZE
})

const data = computed(() => props.data as TData[])
const columns = computed(() => props.columns)

const table = useVueTable<TData>({
  get data() {
    return data.value
  },
  get columns() {
    return columns.value
  },
  state: {
    get sorting() {
      return sorting.value
    },
    get globalFilter() {
      return globalFilter.value
    },
    get pagination() {
      return pagination.value
    }
  },
  get rowCount() {
    return props.rowCount
  },
  manualSorting: props.serverSide,
  manualFiltering: props.serverSide,
  manualPagination: props.serverSide,
  onSortingChange: (updater) => {
    sorting.value = valueUpdater(updater, sorting.value)
    if (props.serverSide) {
      pagination.value = { ...pagination.value, pageIndex: 0 }
      emit("update:sorting", sorting.value)
      emit("update:pagination", pagination.value)
    }
  },
  onGlobalFilterChange: (updater) => {
    globalFilter.value = valueUpdater(updater, globalFilter.value)
    if (props.serverSide) {
      pagination.value = { ...pagination.value, pageIndex: 0 }
      emit("update:globalFilter", globalFilter.value)
      emit("update:pagination", pagination.value)
    }
  },
  onPaginationChange: (updater) => {
    pagination.value = valueUpdater(updater, pagination.value)
    if (props.serverSide) emit("update:pagination", pagination.value)
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getPaginationRowModel: getPaginationRowModel()
})

const globalFilterModel = computed({
  get: () => globalFilter.value,
  set: (value: string) => table.setGlobalFilter(value)
})

/** Класс колонки из `meta.class`: так страница прячет второстепенные колонки на узком экране. */
const metaClass = (column: { columnDef: { meta?: unknown } }): string | undefined =>
  (column.columnDef.meta as { class?: string } | undefined)?.class

const rowClass = computed(() =>
  props.cards ? "max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-3" : undefined
)

const columnCount = computed(
  () => table.getAllLeafColumns().length + (props.rowNumbers ? 1 : 0)
)
const rowOffset = computed(() => {
  if (props.pageSize === undefined) return 0
  const state = table.getState().pagination
  return state.pageIndex * state.pageSize
})
const showToolbar = computed(
  () => props.filter || slots.toolbar !== undefined
)

watchEffect(() => {
  emit(
    "update:visibleRows",
    table.getRowModel().rows.map((row) => row.original)
  )
})
</script>

<template>
  <div>
    <div v-if="showToolbar" class="mb-4 flex flex-wrap items-end gap-3">
      <div v-if="props.filter" class="min-w-52 flex-1 space-y-1.5">
        <Label :for="filterId" class="text-xs text-muted-foreground">
          {{ props.filterLabel }}
        </Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            :id="filterId"
            v-model="globalFilterModel"
            type="text"
            :placeholder="props.filterPlaceholder"
            class="pl-9"
          />
        </div>
      </div>
      <slot name="toolbar" :table="table" />
    </div>

    <slot name="summary" :table="table" />

    <Card>
      <CardContent class="p-0">
        <TableRoot
          :class="props.cards && 'max-sm:block max-sm:[&_tbody]:block max-sm:[&_thead]:hidden'"
        >
          <TableHeader>
            <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <TableHead v-if="props.rowNumbers" class="w-9 px-2 text-right">№</TableHead>
              <TableHead v-for="header in headerGroup.headers" :key="header.id" :class="metaClass(header.column)">
                <FlexRender
                  v-if="!header.isPlaceholder"
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="props.isLoading">
              <TableRow v-for="index in props.loadingRowCount" :key="index" :class="rowClass">
                <TableCell :colspan="columnCount" :class="props.cards && 'max-sm:w-full'">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="table.getRowModel().rows.length === 0" :class="rowClass">
              <TableCell :colspan="columnCount" :class="props.cards && 'max-sm:w-full'">
                <slot name="empty">
                  <EmptyState :title="props.emptyTitle" :description="props.emptyDescription" />
                </slot>
              </TableCell>
            </TableRow>

            <TableRow
              v-for="(row, index) in table.getRowModel().rows"
              :key="row.id"
              :class="rowClass"
            >
              <TableCell
                v-if="props.rowNumbers"
                class="w-9 px-2 text-right tabular-nums text-muted-foreground"
              >
                {{ rowOffset + index + 1 }}
              </TableCell>
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
                :class="cn(props.cards && 'max-sm:p-0', metaClass(cell.column))"
              >
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </TableBody>
        </TableRoot>
      </CardContent>
    </Card>

    <div v-if="props.pageSize !== undefined" class="mt-3">
      <DataTablePagination :table="table" :page-size-options="props.pageSizeOptions" />
    </div>
  </div>
</template>
