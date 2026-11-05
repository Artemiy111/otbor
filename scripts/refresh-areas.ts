/**
 * Rebuilds `packages/contract/src/areas.data.json` from hh's public area tree.
 *
 *   bun scripts/refresh-areas.ts
 *
 * hh groups every foreign country under a pseudo-country "Другие регионы"
 * (id 1001). That container carries no meaning for a filter, so its children are
 * promoted to top-level countries and the container is dropped.
 */
const OTHER_REGIONS = "1001"

interface HhArea {
  readonly id: string
  readonly name: string
  readonly areas: ReadonlyArray<HhArea>
}

const response = await fetch("https://api.hh.ru/areas", { headers: { "User-Agent": "otbor-areas/1.0" } })
if (!response.ok) throw new Error(`hh /areas answered ${response.status}`)
const tree = (await response.json()) as ReadonlyArray<HhArea>

const rows: Array<[number, number, string]> = []
const walk = (area: HhArea, parentId: number) => {
  const id = Number(area.id)
  rows.push([id, parentId, area.name])
  for (const child of area.areas) walk(child, id)
}
for (const top of tree) {
  if (top.id === OTHER_REGIONS) for (const country of top.areas) walk(country, 0)
  else walk(top, 0)
}

await Bun.write(
  new URL("../packages/contract/src/areas.data.json", import.meta.url),
  JSON.stringify(rows)
)
console.log(`${rows.length} areas`)
