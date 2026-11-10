import { ref } from "vue"

/**
 * Строка запроса адреса как реактивное значение. Роутер меняет адрес через
 * History API, а он не сообщает об этом: страница, у которой фильтры живут в
 * адресе, читает `locationSearch` и поэтому реагирует на любую смену адреса,
 * в том числе на переход по ссылке на ту же страницу с другим `?state=`.
 */
export const locationSearch = ref(typeof window === "undefined" ? "" : window.location.search)

/** Вызывается роутером после каждого перехода и при popstate. */
export const syncLocation = (): void => {
  if (typeof window !== "undefined") locationSearch.value = window.location.search
}

if (typeof window !== "undefined") window.addEventListener("popstate", syncLocation)

/**
 * Подменяет строку запроса текущей страницы, не добавляя запись в историю.
 * Пустая строка убирает запрос. Путь не меняется.
 */
export const replaceSearch = (search: string): void => {
  const clean = search.replace(/^\?/, "")
  const next = window.location.pathname + (clean === "" ? "" : `?${clean}`)
  if (next === window.location.pathname + window.location.search) return
  window.history.replaceState({}, "", next)
  syncLocation()
}
