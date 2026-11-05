import { computed, ref } from "vue"

export type Route =
  | { readonly name: "health" }
  | { readonly name: "vacancies" }
  | { readonly name: "vacancy"; readonly id: string }
  | { readonly name: "companies" }
  | { readonly name: "company"; readonly id: string }
  | { readonly name: "keywords" }
  | { readonly name: "analytics" }
  | { readonly name: "decisions" }
  | { readonly name: "applications" }
  | { readonly name: "application"; readonly id: string }
  | { readonly name: "queue" }
  | { readonly name: "inference" }
  | { readonly name: "presets" }
  | { readonly name: "apply-filter" }
  | { readonly name: "auto-apply" }
  | { readonly name: "hydration" }
  | { readonly name: "search" }
  | { readonly name: "schedules" }
  | { readonly name: "contacts" }
  | { readonly name: "mail" }
  | { readonly name: "telegram" }
  | { readonly name: "resumes" }
  | { readonly name: "accounts" }
  | { readonly name: "blacklist" }
  | { readonly name: "settings" }

const parse = (): Route => {
  const raw = window.location.pathname.replace(/^\/+|\/+$/g, "")
  const [head = "", id = ""] = raw.split("/")

  switch (head) {
    case "vacancies":
      return id === "" ? { name: "vacancies" } : { name: "vacancy", id }
    case "hydration":
      return { name: "hydration" }
    case "companies":
      return id === "" ? { name: "companies" } : { name: "company", id }
    case "analytics":
      return { name: "analytics" }
    case "keywords":
      return { name: "keywords" }
    case "decisions":
      return { name: "decisions" }
    case "applications":
      return id === "" ? { name: "applications" } : { name: "application", id }
    case "queue":
      return { name: "queue" }
    case "inference":
      return { name: "inference" }
    case "presets":
      return { name: "presets" }
    case "apply-filter":
      return { name: "apply-filter" }
    case "auto-apply":
      return { name: "auto-apply" }
    case "search":
      return { name: "search" }
    case "schedules":
      return { name: "schedules" }
    case "contacts":
      return { name: "contacts" }
    case "mail":
      return { name: "mail" }
    case "telegram":
      return { name: "telegram" }
    case "resumes":
      return { name: "resumes" }
    case "accounts":
      return { name: "accounts" }
    case "blacklist":
      return { name: "blacklist" }
    case "settings":
      return { name: "settings" }
    case "health":
      return { name: "health" }
    default:
      return { name: "health" }
  }
}

/** One history entry per page; direct URLs work without a hash. */
const navigate = (path: string, replace = false): void => {
  const url = new URL(path, window.location.origin)
  const current = window.location.pathname + window.location.search
  const next = url.pathname + url.search
  if (current === next) return

  if (replace) window.history.replaceState({}, "", next)
  else window.history.pushState({}, "", next)
  route.value = parse()
}

/** Old bookmarks used `#/vacancies`; move them to clean paths once. */
if (window.location.hash.startsWith("#/")) {
  const legacy = window.location.hash.slice(1)
  window.history.replaceState({}, "", legacy)
}

if (window.location.pathname === "/" || window.location.pathname === "") {
  window.history.replaceState({}, "", "/vacancies")
}

export const route = ref<Route>(parse())

window.addEventListener("popstate", () => {
  route.value = parse()
})

/**
 * Pages still use ordinary `<a href="/...">` links. Intercept same-origin
 * clicks so navigation stays client-side without hash URLs.
 */
window.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const target = event.target
  const anchor = target instanceof Element ? target.closest("a") : null
  if (anchor === null) return
  if (anchor.target !== "" && anchor.target !== "_self") return
  if (anchor.hasAttribute("download")) return

  const href = anchor.getAttribute("href")
  if (href === null || !href.startsWith("/") || href.startsWith("//")) return

  const url = new URL(href, window.location.origin)
  if (url.origin !== window.location.origin) return

  event.preventDefault()
  navigate(url.pathname + url.search)
})

/** Detail pages keep their parent list item active in the sidebar. */
export const activeSection = computed<string>(() => {
  switch (route.value.name) {
    case "vacancy":
      return "vacancies"
    case "company":
      return "companies"
    case "application":
      return "applications"
    default:
      return route.value.name
  }
})
