import { ref } from "vue"

/**
 * Перетаскивание на нативном HTML5 DnD — тот же язык, что и у остальных
 * блоков приложения: ручка GripVertical, line-индикатор сверху/снизу.
 */
export const useDragReorder = <T extends { readonly id: number }>(items: () => ReadonlyArray<T>) => {
  const dragId = ref<number | null>(null)
  const overId = ref<number | null>(null)
  const overAfter = ref(false)

  const start = (id: number, event: DragEvent) => {
    dragId.value = id
    const target = event.target as HTMLElement | null
    const row = target?.closest("[data-filter-row], [data-filter-block]")
    if (row !== null && row !== undefined && event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setDragImage(row, 16, 16)
    }
  }

  const over = (id: number, event: DragEvent) => {
    if (dragId.value === null) return
    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    overId.value = id
    overAfter.value = event.clientY > box.top + box.height / 2
  }

  const end = () => {
    dragId.value = null
    overId.value = null
    overAfter.value = false
  }

  /** Возвращает новый порядок или undefined, если перетаскивание не состоялось. */
  const drop = (): Array<T> | undefined => {
    const from = dragId.value
    const target = overId.value
    const after = overAfter.value
    end()
    if (from === null || target === null || from === target) return undefined
    const moved = items().find((item) => item.id === from)
    if (moved === undefined) return undefined
    const rest = items().filter((item) => item.id !== from) as Array<T>
    const at = rest.findIndex((item) => item.id === target) + (after ? 1 : 0)
    rest.splice(at, 0, moved)
    return rest
  }

  return { dragId, overId, overAfter, start, over, end, drop }
}
