import data from "./areas.data.json" with { type: "json" }

/**
 * hh's area tree: country > region > city. A vacancy carries only its own
 * `area` (usually a city), so the country is found by walking up. The snapshot
 * is refreshed with `bun scripts/refresh-areas.ts`.
 *
 * This module is large (about 1 MB): the browser imports it lazily through
 * `@otbor/contract/areas`, and it is not re-exported from the package index.
 */
export interface Area {
  readonly id: number
  /** `0` for a country. */
  readonly parentId: number
  readonly name: string
}

interface AreaIndex {
  readonly byId: ReadonlyMap<number, Area>
  readonly children: ReadonlyMap<number, ReadonlyArray<Area>>
}

let index: AreaIndex | undefined

const load = (): AreaIndex => {
  if (index !== undefined) return index
  const byId = new Map<number, Area>()
  const children = new Map<number, Array<Area>>()
  for (const [id, parentId, name] of data as unknown as ReadonlyArray<readonly [number, number, string]>) {
    const area: Area = { id, parentId, name }
    byId.set(id, area)
    const siblings = children.get(parentId)
    if (siblings === undefined) children.set(parentId, [area])
    else siblings.push(area)
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  index = { byId, children }
  return index
}

export const findArea = (id: number): Area | undefined => load().byId.get(id)

/** Countries for `parentId = 0`, otherwise the direct children of that area. */
export const areaChildren = (parentId: number): ReadonlyArray<Area> =>
  load().children.get(parentId) ?? []

/** The area and everything below it. */
export const areaSubtreeIds = (id: number): ReadonlyArray<number> => {
  const { children } = load()
  const result: Array<number> = []
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()!
    result.push(current)
    for (const child of children.get(current) ?? []) stack.push(child.id)
  }
  return result
}

/** Ids the given selections cover, each selection including its whole subtree. */
export const expandAreaIds = (ids: ReadonlyArray<number>): ReadonlyArray<number> => {
  const covered = new Set<number>()
  for (const id of ids) {
    if (!load().byId.has(id)) {
      covered.add(id)
      continue
    }
    for (const member of areaSubtreeIds(id)) covered.add(member)
  }
  return [...covered]
}

/** `[country, region, city]` names, root first. */
export const areaPath = (id: number): ReadonlyArray<Area> => {
  const { byId } = load()
  const path: Array<Area> = []
  let current = byId.get(id)
  while (current !== undefined) {
    path.unshift(current)
    current = current.parentId === 0 ? undefined : byId.get(current.parentId)
  }
  return path
}

export const areaCountry = (id: number): Area | undefined => areaPath(id)[0]

/** Case-insensitive name search: exact names first, then prefixes, then substrings. */
export const searchAreas = (query: string, limit = 50): ReadonlyArray<Area> => {
  const needle = query.trim().toLowerCase()
  if (needle === "") return []
  const exact: Array<Area> = []
  const prefix: Array<Area> = []
  const inside: Array<Area> = []
  for (const area of load().byId.values()) {
    const name = area.name.toLowerCase()
    if (name === needle) exact.push(area)
    else if (name.startsWith(needle)) prefix.push(area)
    else if (name.includes(needle)) inside.push(area)
  }
  return [...exact, ...prefix, ...inside].slice(0, limit)
}
