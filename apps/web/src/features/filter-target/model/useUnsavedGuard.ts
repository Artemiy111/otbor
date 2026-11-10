import { computed, ref, type Ref } from "vue"
import { useEventListener } from "@vueuse/core"

/**
 * Защита от потери несохранённых правок: закрытие вкладки (системный диалог),
 * переход по внутренней ссылке и смена выбора на странице (наш диалог).
 * Кнопку «назад» браузера не перехватываем: роутер страниц на popstate
 * не даёт отменить переход.
 */
export const useUnsavedGuard = (dirty: Ref<boolean>) => {
  const pending = ref<(() => void) | null>(null)
  let bypass = false

  /** Выполняет действие сразу, а при несохранённых правках сначала спрашивает. */
  const confirmThen = (action: () => void) => {
    if (!dirty.value) return action()
    pending.value = action
  }

  const leave = () => {
    const action = pending.value
    pending.value = null
    action?.()
  }
  const stay = () => {
    pending.value = null
  }

  useEventListener(window, "beforeunload", (event) => {
    if (dirty.value) event.preventDefault()
  })

  // Захват раньше обработчика роутера: ссылка пока не открывается.
  useEventListener(
    window,
    "click",
    (event) => {
      if (bypass || !dirty.value) return
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest("a") : null
      if (anchor === null) return
      if (anchor.target !== "" && anchor.target !== "_self") return
      const href = anchor.getAttribute("href")
      if (href === null || !href.startsWith("/") || href.startsWith("//")) return
      event.preventDefault()
      event.stopPropagation()
      confirmThen(() => {
        bypass = true
        try {
          anchor.click()
        } finally {
          bypass = false
        }
      })
    },
    { capture: true }
  )

  return { open: computed(() => pending.value !== null), confirmThen, leave, stay }
}
