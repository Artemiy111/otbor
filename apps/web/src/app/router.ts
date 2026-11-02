import { computed, ref } from "vue"

export type Route =
  | { readonly name: "health" }
  | { readonly name: "vacancies" }
  | { readonly name: "vacancy"; readonly id: string }
  | { readonly name: "decisions" }
  | { readonly name: "applications" }
  | { readonly name: "application"; readonly id: string }
  | { readonly name: "queue" }
  | { readonly name: "inference" }

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, "")
  const [head = "", id = ""] = raw.split("/")

  switch (head) {
    case "vacancies":
      return id === "" ? { name: "vacancies" } : { name: "vacancy", id }
    case "decisions":
      return { name: "decisions" }
    case "applications":
      return id === "" ? { name: "applications" } : { name: "application", id }
    case "queue":
      return { name: "queue" }
    case "inference":
      return { name: "inference" }
    case "health":
      return { name: "health" }
    default:
      return { name: "health" }
  }
}

/** A hash router is enough for a single-operator local UI. */
export const route = ref<Route>(parse())

if (window.location.hash === "") {
  window.location.hash = "#/health"
}

window.addEventListener("hashchange", () => {
  route.value = parse()
})

export const activeSection = computed<string>(() => {
  switch (route.value.name) {
    case "vacancy":
      return "vacancies"
    case "application":
      return "applications"
    default:
      return route.value.name
  }
})
