import { computed, ref } from "vue"

export type Route =
  | { readonly name: "health" }
  | { readonly name: "vacancies" }
  | { readonly name: "vacancy"; readonly id: string }
  | { readonly name: "companies" }
  | { readonly name: "company"; readonly id: string }
  | { readonly name: "keywords" }
  | { readonly name: "decisions" }
  | { readonly name: "applications" }
  | { readonly name: "application"; readonly id: string }
  | { readonly name: "queue" }
  | { readonly name: "inference" }
  | { readonly name: "presets" }
  | { readonly name: "schedules" }
  | { readonly name: "contacts" }
  | { readonly name: "mail" }
  | { readonly name: "telegram" }

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, "")
  const [head = "", id = ""] = raw.split("/")

  switch (head) {
    case "vacancies":
      return id === "" ? { name: "vacancies" } : { name: "vacancy", id }
    case "companies":
      return id === "" ? { name: "companies" } : { name: "company", id }
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
    case "schedules":
      return { name: "schedules" }
    case "contacts":
      return { name: "contacts" }
    case "mail":
      return { name: "mail" }
    case "telegram":
      return { name: "telegram" }
    case "health":
      return { name: "health" }
    default:
      return { name: "health" }
  }
}

/** A hash router is enough for a single-operator local UI. */
export const route = ref<Route>(parse())

if (window.location.hash === "") {
  window.location.hash = "#/vacancies"
}

window.addEventListener("hashchange", () => {
  route.value = parse()
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
