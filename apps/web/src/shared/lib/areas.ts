import { shallowRef } from "vue"

type AreasModule = typeof import("@otbor/contract/areas")

/**
 * The hh area tree is about 1 MB, so it is fetched as a separate chunk the
 * first time a location rule is shown. Reading `areasModule.value` in a render
 * subscribes to the load.
 */
export const areasModule = shallowRef<AreasModule | null>(null)

let pending: Promise<void> | null = null

export const loadAreas = (): Promise<void> => {
  pending ??= import("@otbor/contract/areas").then((module) => {
    areasModule.value = module
  })
  return pending
}

/** "Москва, Россия" for a city, "Россия" for a country; the id until the tree arrives. */
export const areaLabel = (id: string | number): string => {
  void loadAreas()
  const module = areasModule.value
  if (module === null) return String(id)
  const path = module.areaPath(Number(id))
  if (path.length === 0) return String(id)
  const last = path[path.length - 1]!
  const country = path[0]!
  return last.id === country.id ? last.name : `${last.name}, ${country.name}`
}
