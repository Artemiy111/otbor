import { onBeforeUnmount, onMounted, ref } from "vue"

/**
 * Периодический вызов, пока он нужен: `active()` истинно и вкладка браузера
 * видна. На скрытой вкладке опрос стоит, а при возвращении выполняется сразу.
 */
export const useVisibleInterval = (task: () => void, active: () => boolean, ms = 5000) => {
  const visible = ref(document.visibilityState === "visible")
  let timer: ReturnType<typeof setInterval> | null = null

  const onVisibility = () => {
    visible.value = document.visibilityState === "visible"
    if (visible.value && active()) task()
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility)
    timer = setInterval(() => {
      if (visible.value && !document.hidden && active()) task()
    }, ms)
  })
  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibility)
    if (timer !== null) clearInterval(timer)
    timer = null
  })
}
