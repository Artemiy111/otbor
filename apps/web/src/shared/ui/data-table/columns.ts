import { h } from "vue"
import type {
  ColumnDef,
  HeaderContext,
  RowData,
  Updater
} from "@tanstack/vue-table"
import DataTableColumnHeader from "./DataTableColumnHeader.vue"
import DataTableHeaderFilter, { type HeaderFilterOption } from "./DataTableHeaderFilter.vue"

export type ColumnAlign = "left" | "right"

/** Apply a TanStack state updater the same way the table core does. */
export const valueUpdater = <T>(updater: Updater<T>, value: T): T =>
  typeof updater === "function" ? (updater as (previous: T) => T)(value) : updater

/** A sortable header backed by the shared `DataTableColumnHeader`. */
export const sortableHeader =
  <TData extends RowData>(title: string, align: ColumnAlign = "left") =>
  (context: HeaderContext<TData, unknown>) =>
    h(DataTableColumnHeader, { column: context.column, title, align })

/** A header with a title (sortable when the column allows it) and a select filter below it. */
export const filterableHeader =
  <TData extends RowData>(
    title: string,
    filter: {
      readonly value: () => string
      readonly options: () => ReadonlyArray<HeaderFilterOption>
      readonly onChange: (value: string) => void
    },
    align: ColumnAlign = "left"
  ) =>
  (context: HeaderContext<TData, unknown>) =>
    h(
      DataTableColumnHeader,
      { column: context.column, title, align },
      {
        filter: () =>
          h(DataTableHeaderFilter, {
            modelValue: filter.value(),
            options: filter.options(),
            "onUpdate:modelValue": filter.onChange
          })
      }
    )

export interface TextColumnOptions<TData extends RowData> {
  readonly id: string
  readonly title: string
  readonly accessorFn: (row: TData) => unknown
  readonly sortable?: boolean
  readonly filterable?: boolean
  readonly format?: (value: unknown) => string
  readonly cellClass?: string
}

/**
 * A plain text column: one accessor, optional sorting and global filtering, and
 * a dash for empty values. Cells that need links or badges stay hand-written.
 */
export const textColumn = <TData extends RowData>(
  options: TextColumnOptions<TData>
): ColumnDef<TData, unknown> => {
  const sortable = options.sortable ?? true
  const format = options.format ?? ((value: unknown) => String(value))
  return {
    id: options.id,
    accessorFn: options.accessorFn,
    enableSorting: sortable,
    enableGlobalFilter: options.filterable ?? true,
    header: sortable ? sortableHeader<TData>(options.title) : options.title,
    cell: ({ getValue }) => {
      const value = getValue()
      const empty = value === null || value === undefined || value === ""
      return h(
        "span",
        { class: options.cellClass },
        empty ? "—" : format(value)
      )
    }
  }
}
