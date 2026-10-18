// Builds proto/data/paths.geojson: every way cycle.travel draws as a cycle path, with the surface class it uses.
// The Protomaps basemap has no surface or bicycle tags, so it can't tell these apart on its own.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const [out, dir] = process.argv.slice(2)
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'chipseal', 'metal', 'wood', 'bricks'])
const BIKE = new Set(['yes', 'designated', 'permissive'])
const OFFROAD = new Set(['path', 'footway', 'pedestrian', 'track'])

// cycle.travel's rule, checked against its tiles over Richmond Park: paved paths you can ride draw red and white,
// unpaved ones (gravel cycleways, bridleways) brown dashes, and bridleways closed to bikes as plain footpaths.
// With no surface tag, cycleways and urban path types count as paved, bridleways and tracks as unpaved.
const classify = (t) => {
  const hw = t.highway
  if (hw === 'bridleway' && (t.bicycle === 'no' || t.bicycle === 'dismount')) return 'f'
  if (t.bicycle === 'no' || t.access === 'private' || t.access === 'no') return null
  if (!(hw === 'cycleway' || hw === 'bridleway' || (OFFROAD.has(hw) && BIKE.has(t.bicycle)))) return null
  const paved = t.surface ? PAVED.has(t.surface) : hw === 'track' ? t.tracktype === 'grade1' : hw !== 'bridleway'
  return paved ? 'p' : 'u'
}

const ways = new Map()
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
  if (data.remark) console.error(f, data.remark)
  for (const w of data.elements) if (w.type === 'way' && w.geometry && !ways.has(w.id)) ways.set(w.id, w)
}

// Unpaved paths, footways and tracks are also basemap footpaths, so their dashes need the green dots knocked out
// underneath (k). Tunnels are left out like the basemap's own paths.
const groups = new Map()
const counts = {}
for (const w of ways.values()) {
  const t = w.tags ?? {}
  const c = classify(t)
  if (!c || t.tunnel === 'yes' || t.area === 'yes') continue
  const k = c === 'u' && ['path', 'footway', 'track', 'steps'].includes(t.highway) ? 1 : 0
  const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0
  const key = `${c}${k}${bridge}`
  counts[key] = (counts[key] ?? 0) + 1
  if (!groups.has(key)) groups.set(key, { props: { c, k, bridge }, lines: [] })
  groups.get(key).lines.push(w.geometry.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]))
}

// Chain ways that share an endpoint so the brown dashes don't restart at every OSM way join.
const pt = (c) => c.join(',')
const features = []
for (const { props, lines } of groups.values()) {
  const byEnd = new Map()
  lines.forEach((l, i) => { for (const c of [l[0], l.at(-1)]) (byEnd.get(pt(c)) ?? byEnd.set(pt(c), []).get(pt(c))).push(i) })
  const used = new Uint8Array(lines.length)
  const take = (c) => {
    const i = (byEnd.get(pt(c)) ?? []).find((j) => !used[j])
    if (i === undefined) return null
    used[i] = 1
    return pt(lines[i][0]) === pt(c) ? lines[i] : [...lines[i]].reverse()
  }
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let chain = [...lines[i]], next
    while ((next = take(chain.at(-1)))) chain.push(...next.slice(1))
    while ((next = take(chain[0]))) chain = [...next.reverse(), ...chain.slice(1)]
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: chain } })
  }
}
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(ways.size, 'ways ->', features.length, 'features', counts)
